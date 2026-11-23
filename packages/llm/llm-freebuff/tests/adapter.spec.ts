import { writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { FREEBUFF_KEY } from '../src/index.ts'
import { assistantMessage, collect, failureOf, harness, userMessage } from './harness.ts'

describe('Freebuff model route', () => {
  it('streams one turn, spawns with --cwd and returns the chat in the replay state', async () => {
    const h = await harness()
    const cwd = h.workspace('proj')
    const id = h.session('s1', cwd)
    h.host.script = { reply: () => 'The answer.' }
    const result = await collect(h, id, [userMessage('hello there')])
    expect(result.text).toBe('The answer.')
    expect(result.finish.reason).toEqual({ kind: 'stop' })
    expect(result.chunks.map(chunk => chunk.type)).toEqual(['block-start', 'text-delta', 'block-end', 'finish'])
    const spec = h.host.spawns[0]!
    expect(spec.argv.slice(-2)).toEqual(['--cwd', cwd])
    expect(spec.cwd).toBe(cwd)
    const replay = (result.finish.replayState?.response ?? {}) as Record<string, unknown>
    expect(replay).toMatchObject({ kind: 'freebuff', version: 1, chatId: expect.any(String) as unknown })
    expect(h.host.prompts).toEqual(['hello there'])
  })

  it('keeps one terminal per session and submits only the newest user text', async () => {
    const h = await harness()
    const id = h.session('s1', h.workspace('proj'))
    const first = await collect(h, id, [userMessage('first')])
    const second = await collect(h, id, [
      userMessage('first'),
      assistantMessage(first.text, first.finish.replayState?.response),
      userMessage('second'),
    ])
    expect(second.text).toBe('echo: second')
    expect(h.host.spawns).toHaveLength(1)
    expect(h.host.prompts).toEqual(['first', 'second'])
  })

  it('respawns an idle-reaped session with --continue and its chat id', async () => {
    const h = await harness({ idleReapMs: 30 })
    const id = h.session('s1', h.workspace('proj'))
    const first = await collect(h, id, [userMessage('first')])
    await delay(150)
    expect(h.host.killed).toBe(1)
    const second = await collect(h, id, [
      userMessage('first'),
      assistantMessage(first.text, first.finish.replayState?.response),
      userMessage('second'),
    ])
    expect(second.text).toBe('echo: second')
    expect(h.host.spawns).toHaveLength(2)
    const chatId = ((first.finish.replayState?.response ?? {}) as { chatId: string }).chatId
    expect(h.host.spawns[1]!.argv).toContain('--continue')
    expect(h.host.spawns[1]!.argv).toContain(chatId)
  })

  it('refuses purposes, a missing session id, an unknown session and a sandboxed session', async () => {
    const h = await harness({ sandbox: 'workspace-write' })
    const id = h.session('s1', h.workspace('proj'))
    expect(failureOf(await collect(h, id, [userMessage('x')], { purpose: 'compaction' })).message).toContain('compaction')
    expect(failureOf(await collect(h, undefined, [userMessage('x')])).code).toBe('INVALID_REQUEST')
    expect(failureOf(await collect(h, 'ghost' as never, [userMessage('x')])).message).toContain('unknown')
    const sandboxed = failureOf(await collect(h, id, [userMessage('x')]))
    expect(sandboxed.message).toContain('danger-full-access')
    expect(h.host.spawns).toHaveLength(0)
  })

  it('lets a danger-full-access session through', async () => {
    const h = await harness({ sandbox: 'danger-full-access' })
    const id = h.session('s1', h.workspace('proj'))
    expect((await collect(h, id, [userMessage('x')])).text).toBe('echo: x')
  })

  it('rejects slash and bang prompts, images and empty prompts before spawning', async () => {
    const h = await harness()
    const id = h.session('s1', h.workspace('proj'))
    expect(failureOf(await collect(h, id, [userMessage('/model')])).code).toBe('INVALID_REQUEST')
    expect(failureOf(await collect(h, id, [userMessage('!rm -rf x')])).code).toBe('INVALID_REQUEST')
    expect(failureOf(await collect(h, id, [userMessage('  \u0007 ')])).message).toContain('empty')
    expect(failureOf(await collect(h, id, [{ role: 'user', content: [{ type: 'image' } as never] }])).code).toBe('UNSUPPORTED_CONTENT')
    expect(failureOf(await collect(h, id, [])).message).toContain('no user message')
    expect(h.host.spawns).toHaveLength(0)
  })

  it('uses the newest user-sourced message, not injected context', async () => {
    const h = await harness()
    const id = h.session('s1', h.workspace('proj'))
    const injected = { id: 'c', role: 'user', content: [{ type: 'text', text: 'context note' }], source: { kind: 'note' } }
    const typed = { id: 't', role: 'user', content: [{ type: 'text', text: 'real question' }], source: { kind: 'user' } }
    const result = await collect(h, id, [typed, injected] as never)
    expect(result.text).toBe('echo: real question')
  })

  it('surfaces a Freebuff refusal verbatim and never submits the prompt twice', async () => {
    const h = await harness()
    const id = h.session('s1', h.workspace('proj'))
    h.host.script = { refusal: 'Your request was declined by the usage policy.' }
    const first = await collect(h, id, [userMessage('do it')])
    expect(failureOf(first).message).toBe('Your request was declined by the usage policy.')
    const again = await collect(h, id, [userMessage('do it')])
    expect(failureOf(again).message).toBe('Your request was declined by the usage policy.')
    expect(h.host.prompts).toEqual(['do it'])
  })

  it('answers a login screen with a sign-in error and drops the stored marker', async () => {
    const h = await harness()
    writeFileSync(h.state, 'out')
    await h.ctx.credentials.modifyRecord(FREEBUFF_KEY, () => Promise.resolve({ kind: 'grant', payload: { via: 'freebuff-cli' } }))
    const id = h.session('s1', h.workspace('proj'))
    h.host.script = { login: true }
    const result = await collect(h, id, [userMessage('hi')])
    expect(failureOf(result).code).toBe('ACCOUNT_SIGN_IN_REQUIRED')
    expect((await h.ctx.credentials.describeRecord(FREEBUFF_KEY)).configured).toBe(false)
    expect(h.host.killed).toBe(1)
  })

  it('fails the turn when the terminal exits and respawns on the next one', async () => {
    const h = await harness()
    const id = h.session('s1', h.workspace('proj'))
    h.host.script = { exitOnSubmit: true }
    const failed = await collect(h, id, [userMessage('one')])
    expect(failureOf(failed).code).toBe('STREAM_CLOSED')
    h.host.script = {}
    const next = await collect(h, id, [userMessage('two')])
    expect(next.text).toBe('echo: two')
    expect(h.host.spawns).toHaveLength(2)
  })

  it('sends Escape on cancel and keeps a terminal that stops working', async () => {
    const h = await harness()
    const id = h.session('s1', h.workspace('proj'))
    h.host.script = { hold: true }
    const abort = new AbortController()
    setTimeout(() => { abort.abort() }, 150)
    await collect(h, id, [userMessage('long task')], { signal: abort.signal })
    expect(h.host.escapes).toBe(1)
    expect(h.host.killed).toBe(0)
    h.host.script = {}
    const next = await collect(h, id, [userMessage('long task')])
    expect(next.text).toBe('echo: long task')
    expect(h.host.prompts).toEqual(['long task', 'long task'])
    expect(h.host.spawns).toHaveLength(1)
  })

  it('kills a terminal that ignores Escape', async () => {
    const h = await harness()
    const id = h.session('s1', h.workspace('proj'))
    h.host.script = { hold: true, ignoreEscape: true }
    const abort = new AbortController()
    setTimeout(() => { abort.abort() }, 150)
    await collect(h, id, [userMessage('long task')], { signal: abort.signal })
    expect(h.host.escapes).toBe(1)
    expect(h.host.killed).toBe(1)
  })

  it('binds two sessions in workspaces with the same name to their own chats', async () => {
    const h = await harness()
    const left = h.session('left', h.workspace('proj', h.workspace('a')))
    const right = h.session('right', h.workspace('proj', h.workspace('b')))
    h.host.script = { replyDelayMs: 60 }
    const [a, b] = await Promise.all([
      collect(h, left, [userMessage('left question')]),
      collect(h, right, [userMessage('right question')]),
    ])
    expect(a.text).toBe('echo: left question')
    expect(b.text).toBe('echo: right question')
    const chat = (result: typeof a): string => ((result.finish.replayState?.response ?? {}) as { chatId: string }).chatId
    expect(chat(a)).not.toBe(chat(b))
  })

  it('evicts the longest idle terminal beyond the limit and refuses when all are working', async () => {
    const h = await harness({ timing: { maxTerminals: 2 } })
    const ids = ['a', 'b', 'c'].map(name => h.session(name, h.workspace(name)))
    await collect(h, ids[0]!, [userMessage('one')])
    await collect(h, ids[1]!, [userMessage('two')])
    await collect(h, ids[2]!, [userMessage('three')])
    expect(h.host.killed).toBe(1)
    h.host.script = { hold: true }
    const abort = new AbortController()
    const busy = [ids[1]!, ids[2]!].map(id => collect(h, id, [userMessage('four')], { signal: abort.signal }))
    await delay(100)
    const extra = h.session('d', h.workspace('d'))
    expect(failureOf(await collect(h, extra, [userMessage('five')])).message).toContain('sessions running')
    abort.abort()
    await Promise.all(busy)
  })

  it('lists the model only while Freebuff is signed in, and mirrors the marker', async () => {
    const h = await harness()
    const listed = await h.ctx.llm.listModels('freebuff')
    expect(listed.map(model => model.id)).toEqual(['default'])
    expect(listed[0]!.name).toBe('Freebuff')
    expect((await h.ctx.credentials.describeRecord(FREEBUFF_KEY)).configured).toBe(true)
    writeFileSync(h.state, 'out')
    expect(await h.ctx.llm.listModels('freebuff')).toEqual([])
    expect((await h.ctx.credentials.describeRecord(FREEBUFF_KEY)).configured).toBe(false)
  })

  it('declares no retries and registers its provider row with OAuth sign-in', async () => {
    const h = await harness()
    expect(h.ctx.llm.providerRetryPolicy('freebuff')).toMatchObject({ mode: 'normal', maxRetries: 0 })
    const row = h.ctx.llm.listConfigurableProviders().find(entry => entry.provider === 'freebuff')
    expect(row).toMatchObject({ displayName: 'Freebuff', nativeAuth: { env: [], oauth: true } })
    expect(h.ctx.authorization.describe(FREEBUFF_KEY)?.methods[0]).toMatchObject({ id: 'cli', label: 'Sign in with Freebuff' })
  })
})
