import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { FreebuffPool, type TurnRequest } from '../src/session.ts'
import { assistantMessage, collect, failureOf, harness, userMessage, type Harness } from './harness.ts'

function chatOf(h: Harness, cwd: string): { chatId: string; rows: { id: string }[] } {
  const dir = h.host.chatsDir(cwd)
  const chatId = readdirSync(dir)[0]!
  return { chatId, rows: JSON.parse(readFileSync(join(dir, chatId, 'chat-messages.json'), 'utf8')) as { id: string }[] }
}

const replay = (chatId: string, consumed?: string): ReturnType<typeof assistantMessage> =>
  assistantMessage('earlier', { kind: 'freebuff', version: 1, chatId, ...consumed === undefined ? {} : { consumed } })

function request(cwd: string, signal: AbortSignal, prompt = 'hi'): TurnRequest {
  return { prompt, cwd, chatId: undefined, consumed: undefined, signal }
}

describe('Freebuff session guards', () => {
  it('refuses a second turn while one is running', async () => {
    const h = await harness()
    const cwd = h.workspace('proj')
    h.host.script = { hold: true }
    const abort = new AbortController()
    const session = h.pool().session('s1')
    const first = session.turn(request(cwd, abort.signal)).next()
    await delay(60)
    await expect(session.turn(request(cwd, abort.signal)).next()).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    abort.abort()
    await first.catch(() => {})
  })

  it('stops a turn that was aborted while it waited for another session to spawn', async () => {
    const h = await harness({ timing: { pasteSettleMs: 200 } })
    const left = h.session('left', h.workspace('left'))
    const right = h.session('right', h.workspace('right'))
    const abort = new AbortController()
    setTimeout(() => { abort.abort() }, 50)
    const [first, second] = await Promise.all([
      collect(h, left, [userMessage('one')]),
      collect(h, right, [userMessage('two')], { signal: abort.signal }),
    ])
    expect(first.text).toBe('echo: one')
    expect(second.finish.reason.kind).toBe('aborted')
    expect(h.host.prompts).toEqual(['one'])
  })

  it('cancels a turn that is still waiting for the terminal and tolerates a failed Escape write', async () => {
    const h = await harness()
    h.host.script = { stuck: true, failEscape: true }
    const abort = new AbortController()
    setTimeout(() => { abort.abort() }, 100)
    const result = await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')], { signal: abort.signal })
    expect(result.finish.reason.kind).toBe('aborted')
    expect(h.host.escapes).toBe(1)
  })

  it('answers terminal queries even when the reply cannot be written, and ignores output stream errors', async () => {
    const h = await harness()
    h.host.script = { query: true, failReplies: true }
    const result = await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')])
    expect(result.text).toBe('echo: go')
    expect(() => h.host.terminals[0]!.output.emit('error', new Error('closed'))).not.toThrow()
  })

  it('keeps answering a trust prompt only once while it is still on screen', async () => {
    const h = await harness()
    h.host.script = { trust: true, trustDelayMs: 80 }
    const result = await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')])
    expect(result.text).toBe('echo: go')
    expect(h.host.trustAnswers).toBe(1)
  })

  it('survives a terminal that fails to stop', async () => {
    const h = await harness()
    await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')])
    h.host.script = { failStop: true }
    await expect(h.pool().session('s1').kill()).resolves.toBeUndefined()
    expect(h.host.killed).toBe(1)
  })

  it('still reports a sign-in error when dropping the sign-in marker fails', async () => {
    const h = await harness()
    const pool = new FreebuffPool({ ...h.pool().options, account: { signedOut: () => Promise.reject(new Error('locked')) } as never })
    h.host.script = { login: true }
    const turn = pool.session('s1').turn(request(h.workspace('proj'), new AbortController().signal))
    await expect(turn.next()).rejects.toMatchObject({ failure: { code: 'ACCOUNT_SIGN_IN_REQUIRED' } })
    await pool.dispose()
  })

  it('respawns when the idle terminal exited between turns', async () => {
    const h = await harness()
    const id = h.session('s1', h.workspace('proj'))
    const first = await collect(h, id, [userMessage('one')])
    await h.host.terminals[0]!.terminate()
    await delay(30)
    const next = await collect(h, id, [userMessage('one'), assistantMessage(first.text, first.finish.replayState?.response), userMessage('two')])
    expect(next.text).toBe('echo: two')
    expect(h.host.spawns).toHaveLength(2)
  })
})

describe('Freebuff chat resumption', () => {
  it('resumes a chat from another session through its replay state, with or without a stored position', async () => {
    const h = await harness()
    const cwd = h.workspace('proj')
    await collect(h, h.session('s1', cwd), [userMessage('one')])
    const { chatId, rows } = chatOf(h, cwd)
    const consumed = rows.at(-1)!.id
    const viaPosition = await collect(h, h.session('s2', cwd), [userMessage('one'), replay(chatId, consumed), userMessage('two')])
    expect(viaPosition.text).toBe('echo: two')
    expect(h.host.spawns[1]!.argv).toEqual(expect.arrayContaining(['--continue', chatId]))
    const unknownPosition = await collect(h, h.session('s3', cwd), [replay(chatId, 'missing'), userMessage('three')])
    expect(unknownPosition.text).toBe('echo: three')
    const noPosition = await collect(h, h.session('s4', cwd), [replay(chatId), userMessage('four')])
    expect(noPosition.text).toBe('echo: four')
  })

  it('moves ahead to the stored position when the session lost it in a failed turn', async () => {
    const h = await harness()
    const cwd = h.workspace('proj')
    const id = h.session('s1', cwd)
    h.host.script = { errorRow: 'boom' }
    expect(failureOf(await collect(h, id, [userMessage('one')])).message).toBe('boom')
    const { chatId, rows } = chatOf(h, cwd)
    h.host.script = {}
    const next = await collect(h, id, [replay(chatId, rows.at(-1)!.id), userMessage('two')])
    expect(next.text).toBe('echo: two')
    expect(h.host.spawns[1]!.argv).toEqual(expect.arrayContaining(['--continue', chatId]))
  })

  it('finishes from a ready screen when the reply row never turns complete', async () => {
    const h = await harness()
    const cwd = h.workspace('proj')
    h.host.script = { incomplete: true }
    const first = await collect(h, h.session('s1', cwd), [userMessage('q')])
    expect(first.text).toBe('echo: q')
    const { chatId, rows } = chatOf(h, cwd)
    const again = await collect(h, h.session('s2', cwd), [replay(chatId, rows[0]!.id), userMessage('q')])
    expect(again.text).toBe('echo: q')
    expect(h.host.prompts).toEqual(['q'])
  })

  it('fails when a resumed prompt never shows up in its chat', async () => {
    const h = await harness({ timing: { startupTimeoutMs: 300 } })
    const cwd = h.workspace('proj')
    await collect(h, h.session('s1', cwd), [userMessage('one')])
    const { chatId, rows } = chatOf(h, cwd)
    h.host.script = { silent: true }
    const result = await collect(h, h.session('s2', cwd), [replay(chatId, rows.at(-1)!.id), userMessage('two')])
    expect(failureOf(result).message).toBe('Freebuff did not start working on the prompt.')
    const ghost = await collect(h, h.session('s3', cwd), [replay('no-such-chat'), userMessage('three')])
    expect(failureOf(ghost).message).toBe('Freebuff did not start working on the prompt.')
  })
})

describe('Freebuff mid-turn screens', () => {
  it('turns a login screen during the turn into a sign-in error', async () => {
    const h = await harness()
    h.host.script = { midLogin: true }
    expect(failureOf(await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')])).code).toBe('ACCOUNT_SIGN_IN_REQUIRED')
  })

  it('names a blocking prompt that appears during the turn', async () => {
    const h = await harness()
    h.host.script = { midBlocker: 'Enter: retry' }
    expect(failureOf(await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')])).message).toContain('Enter: retry')
  })

  it('keeps going when Freebuff recovers from an error row, and fails with its text when it does not', async () => {
    const h = await harness()
    h.host.script = { errorRow: 'Network hiccup', recovers: true }
    const recovered = await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')])
    expect(recovered.finish.reason.kind).toBe('stop')
    expect(recovered.text).toBe('echo: go')
    h.host.script = { errorRow: 'Network gone' }
    expect(failureOf(await collect(h, h.session('s2', h.workspace('other')), [userMessage('go')])).message).toBe('Network gone')
  })

  it('does not treat a later incomplete reply as a recovery', async () => {
    const h = await harness()
    h.host.script = { errorRow: 'Out of hours', recovers: true, incomplete: true }
    expect(failureOf(await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')])).message).toBe('Out of hours')
  })

  it('gives an error row without text a generic message', async () => {
    const h = await harness()
    h.host.script = { errorRow: '' }
    expect(failureOf(await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')])).message).toBe('Freebuff reported an error.')
  })
})

describe('Freebuff streamed blocks', () => {
  it('streams only the new tail of a growing reply', async () => {
    const h = await harness()
    h.host.script = { stages: [{ content: 'par' }, { content: 'part two' }], replyDelayMs: 80 }
    const result = await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')])
    expect(result.chunks.flatMap(chunk => chunk.type === 'text-delta' ? [chunk.text] : [])).toEqual(['par', 't two'])
  })

  it('does not resend a block that did not change when a later block appears', async () => {
    const h = await harness()
    h.host.script = { stages: [{ reasoning: 'hmm' }, { reasoning: 'hmm', content: 'done' }], replyDelayMs: 80 }
    const result = await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')])
    expect(result.chunks.flatMap(chunk => chunk.type === 'reasoning-delta' ? [chunk.text] : [])).toEqual(['hmm'])
    expect(result.text).toBe('done')
  })

  it('keeps what it already showed when Freebuff rewrites a block', async () => {
    const h = await harness()
    h.host.script = { stages: [{ content: 'abc' }, { content: 'xyz' }], replyDelayMs: 80 }
    const result = await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')])
    expect(result.text).toBe('abc')
  })
})
