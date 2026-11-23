import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { apply as turnOutlineApply, inject as turnOutlineInject, name as turnOutlineName } from '@deepseek-ai/dsh-session-turn-outline'
import { turnOutlineProjectionDefinition } from '../../../session/session-turn-outline/src/projection.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { HistoryController } from '../src/history/controller.ts'
import { OUTLINE_PAGE_LIMIT, outlinePage } from '../src/history/outline.ts'
import type { SessionOutlineEntry } from '../src/types.ts'
import { installSessionReadTestServices } from './test-remote.ts'

type Content = readonly { readonly type: string; readonly text?: string }[]

let seq = 0
function raw(type: string, data: unknown): SessionEvent {
  return { type, seq, time: seq++, data } as SessionEvent
}
const start = (turn: number) => raw('turn/start', { turn })
const end = (turn: number) => raw('turn/end', { turn, reason: { kind: 'completed' } })
const user = (content: Content, kind = 'user') => raw('user/message', { content, source: { kind } })
const assistant = (content: Content) => raw('assistant/message', { message: { content } })
const text = (value: string) => ({ type: 'text', text: value })

function reference(events: readonly SessionEvent[]): readonly SessionOutlineEntry[] {
  let state = turnOutlineProjectionDefinition.init()
  for (const event of events) state = turnOutlineProjectionDefinition.apply(state, event as never)
  return state.turns
}

describe('outlinePage fold', () => {
  it('matches the turnOutline projection over every preview and ordering rule', () => {
    seq = 0
    const events = [
      user([text('before any turn')]),
      start(1),
      user([text('  hello \n  world  '), { type: 'image' }, text('second block')]),
      user([text('steering later')]),
      assistant([text('draft one')]),
      assistant([{ type: 'image' }]),
      assistant([text('final answer '.repeat(30))]),
      end(1),
      start(2),
      user([{ type: 'image' }]),
      user([text('x'.repeat(500))], 'system'),
      user([text('late prompt')]),
      assistant([text('never settled')]),
      start(2),
      user([text('retry prompt ignored')]),
      start(4),
      end(4),
      start(5),
      user([text('p5')]),
      assistant([text('r5')]),
      end(5),
    ]
    const entries = outlinePage(events, events.length, OUTLINE_PAGE_LIMIT).entries
    expect(entries).toEqual(reference(events))
    expect(entries.map(entry => entry.turn)).toEqual([1, 2, 4, 5])
    expect(entries.find(entry => entry.turn === 2)?.prompt).toBe('late prompt')
  })

  it('stops at the entry budget and reports the oldest entry seq as the next cursor', () => {
    seq = 0
    const events = Array.from({ length: 10 }, (_, index) => [start(index + 1), user([text(`p${String(index + 1)}`)]), end(index + 1)]).flat()
    const page = outlinePage(events, events.length, 4)
    expect(page.entries.map(entry => entry.turn)).toEqual([7, 8, 9, 10])
    expect(page).toMatchObject({ hasMore: true, before: 18 })
    const older = outlinePage(events, page.before, 4)
    expect(older.entries.map(entry => entry.turn)).toEqual([3, 4, 5, 6])
    const oldest = outlinePage(events, older.before, 4)
    expect(oldest).toMatchObject({ hasMore: false, before: 0 })
    expect(oldest.entries.map(entry => entry.turn)).toEqual([1, 2])
  })

  it('always advances its cursor when one turn is longer than the scan cap', () => {
    seq = 0
    const events = [start(1), user([text('long turn prompt')]), ...Array.from({ length: 95 }, () => assistant([text('step')])), end(1)]
    let before = events.length
    let calls = 0
    let found: readonly SessionOutlineEntry[] = []
    for (let hasMore = true; hasMore;) {
      const page = outlinePage(events, before, 5, 20)
      expect(page.before).toBeLessThan(before)
      before = page.before
      hasMore = page.hasMore
      if (page.entries.length > 0) found = page.entries
      expect(++calls).toBeLessThan(10)
    }
    expect(found).toEqual([{ turn: 1, seq: 0, prompt: 'long turn prompt', response: '' }])
  })

  it('returns an empty exhausted page for an empty prefix', () => {
    expect(outlinePage([], 0, 5)).toEqual({ entries: [], hasMore: false, before: 0 })
  })
})

const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin({ name: turnOutlineName, inject: turnOutlineInject, apply: turnOutlineApply })
  installSessionReadTestServices(ctx)
  const history = new HistoryController(ctx)
  const session = ctx.sessions.create(brandString<SessionId>('outline-target'), { meta: { cwd: '/outline-test' } })
  const address = { kind: 'session' as const, sessionId: session.id }
  const signal = new AbortController().signal
  return { ctx, history, session, address, signal }
}

function appendTurn(session: Awaited<ReturnType<typeof fixture>>['session'], turn: number): void {
  session.append('turn/start', { turn })
  session.append('user/message', createMessage({ role: 'user', content: [{ type: 'text', text: `prompt ${String(turn)}` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn, step: 1,
    message: createMessage({ role: 'assistant', content: [{ type: 'text', text: `answer ${String(turn)}` }], source: { kind: 'model', provider: 'p', model: 'm' } }),
    stream: [],
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('HistoryController outline', () => {
  it('pages past the projection window and its newest page equals the projection value', async () => {
    const f = await fixture()
    for (let turn = 1; turn <= 1_200; turn++) appendTurn(f.session, turn)
    const live = f.ctx.sessionProjections.snapshot(f.session).values.turnOutline
    expect(live).toHaveLength(500)
    const newest = await f.history.outline({ address: f.address }, f.signal)
    expect(newest.entries).toEqual(live)
    expect(newest).toMatchObject({ hasMore: true, before: live?.[0]?.seq })
    const middle = await f.history.outline({ address: f.address, beforeSeq: newest.before }, f.signal)
    const oldest = await f.history.outline({ address: f.address, beforeSeq: middle.before }, f.signal)
    expect(middle.entries.map(entry => entry.turn)).toEqual(Array.from({ length: 500 }, (_, index) => 201 + index))
    expect(oldest).toMatchObject({ hasMore: false, before: 0 })
    expect(oldest.entries.map(entry => entry.turn)).toEqual(Array.from({ length: 200 }, (_, index) => 1 + index))
    expect(oldest.entries[0]).toEqual({ turn: 1, seq: 0, prompt: 'prompt 1', response: 'answer 1' })
    expect(middle.entries.at(-1)?.seq).toBeLessThan(newest.before)
  })

  it('honors maxEntries and an empty cursor', async () => {
    const f = await fixture()
    for (let turn = 1; turn <= 5; turn++) appendTurn(f.session, turn)
    const page = await f.history.outline({ address: f.address, maxEntries: 2 }, f.signal)
    expect(page.entries.map(entry => entry.turn)).toEqual([4, 5])
    expect(await f.history.outline({ address: f.address, beforeSeq: 0 }, f.signal)).toEqual({ entries: [], hasMore: false, before: 0 })
  })

  it('rejects invalid cursors and budgets before reading', async () => {
    const f = await fixture()
    for (const beforeSeq of [-1, 1.5, -0, Number.NaN]) {
      await expect(f.history.outline({ address: f.address, beforeSeq }, f.signal)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    }
    for (const maxEntries of [0, -1, 1.5, OUTLINE_PAGE_LIMIT + 1]) {
      await expect(f.history.outline({ address: f.address, maxEntries }, f.signal)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    }
  })

  it('rejects a missing Session and a subagent address that does not belong to the Session', async () => {
    const f = await fixture()
    await expect(f.history.outline({ address: { kind: 'session', sessionId: brandString<SessionId>('missing') } }, f.signal))
      .rejects.toMatchObject({ code: 'session/not-found' })
    await expect(f.history.outline({
      address: { kind: 'subagent', parentSessionId: f.session.id, childSessionId: f.session.id, mode: 'continuable' },
    }, f.signal)).rejects.toMatchObject({ code: 'subagent/unauthorized' })
  })
})
