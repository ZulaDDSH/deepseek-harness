import { describe, expect, onTestFinished, vi } from 'vitest'
import type { SessionControlFrame } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, type ClientTestFixtures, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { SessionManager } from '../src/client/sessions/manager.ts'
import { ProjectionValueStore } from '../src/client/sessions/projection-store.ts'
import type { SessionRemotes } from '../src/client/sessions/remotes.ts'

const it = createClientTest({ roster: webApp.closure(['@deepseek-ai/dsh-api-gateway']) })

const SID = 'fk-append' as SessionId
const entry = (id: string) => ({ id, createdAt: 1, name: id, mode: 'external', label: id })

function makeManager(remote: ClientTestFixtures['remote']): SessionManager {
  const manager = new SessionManager(remote as ClientTestFixtures['remote'] & SessionRemotes)
  onTestFinished(() => manager.dispose())
  return manager
}

type ProjectionChanges = Extract<SessionControlFrame, { type: 'projection' }>['changes']

function frame(seq: number, changes: ProjectionChanges): SessionControlFrame {
  return { type: 'projection', sessionId: SID, seq, changes } as SessionControlFrame
}

describe('projection store appends', () => {
  it('extends a sequenced array when the append starts at the held length', () => {
    const store = new ProjectionValueStore()
    store.apply('subagentCatalog', [entry('a')], SessionSeq(1))
    const before = store.get('subagentCatalog')
    expect(store.append('subagentCatalog', 1, [entry('b')], SessionSeq(2))).toBe(true)
    expect(store.get('subagentCatalog')).toEqual([entry('a'), entry('b')])
    expect(store.get('subagentCatalog')).not.toBe(before)
    expect(store.seqOf('subagentCatalog')).toBe(2)
  })

  it('accepts a replayed append as already reflected and leaves the value alone', () => {
    const store = new ProjectionValueStore()
    store.apply('subagentCatalog', [entry('a'), entry('b')], SessionSeq(2))
    const held = store.get('subagentCatalog')
    expect(store.append('subagentCatalog', 1, [entry('b')], SessionSeq(2))).toBe(true)
    expect(store.get('subagentCatalog')).toBe(held)
  })

  it('reports a gap when the held length differs from the append start', () => {
    const store = new ProjectionValueStore()
    store.apply('subagentCatalog', [entry('a')], SessionSeq(1))
    expect(store.append('subagentCatalog', 3, [entry('d')], SessionSeq(4))).toBe(false)
    expect(store.get('subagentCatalog')).toEqual([entry('a')])
  })

  it('reports a gap for an absent key and for a cached row', () => {
    const store = new ProjectionValueStore()
    expect(store.append('subagentCatalog', 0, [entry('a')], SessionSeq(1))).toBe(false)
    store.applyCached({ subagentCatalog: [entry('a')] })
    expect(store.append('subagentCatalog', 1, [entry('b')], SessionSeq(2))).toBe(false)
    expect(store.get('subagentCatalog')).toEqual([entry('a')])
  })
})

describe('manager append routing', () => {
  it('applies a whole value then appends that follow it', ({ remote }) => {
    const manager = makeManager(remote)
    manager.handleControlFrame(frame(1, [{ key: 'subagentCatalog', val: [entry('a')] }]))
    manager.handleControlFrame(frame(2, [{ key: 'subagentCatalog', append: { from: 1, items: [entry('b')] } }]))
    expect(manager.projectionValues(SID)?.subagentCatalog).toEqual([entry('a'), entry('b')])
  })

  it('reloads the Session projections instead of guessing when an append cannot apply', ({ remote }) => {
    remote.session.projections.mockResolvedValue(ok(null) as never)
    const manager = makeManager(remote)
    manager.handleControlFrame(frame(3, [{ key: 'subagentCatalog', append: { from: 5, items: [entry('x')] } }]))
    expect(remote.session.projections).toHaveBeenCalledWith({ sessionId: SID }, expect.anything())
    expect(manager.projectionValues(SID)?.subagentCatalog).toBeUndefined()
  })

  it('queues one more read when a gap arrives while a projection read is in flight', async ({ remote }) => {
    const first = Promise.withResolvers<ReturnType<typeof ok>>()
    remote.session.projections.mockReturnValueOnce(first.promise as never).mockResolvedValue(ok(null) as never)
    const manager = makeManager(remote)
    manager.handleControlFrame(frame(3, [{ key: 'subagentCatalog', append: { from: 5, items: [entry('x')] } }]))
    manager.handleControlFrame(frame(4, [{ key: 'subagentCatalog', append: { from: 7, items: [entry('y')] } }]))
    manager.handleControlFrame(frame(5, [{ key: 'subagentCatalog', append: { from: 9, items: [entry('z')] } }]))
    expect(remote.session.projections).toHaveBeenCalledTimes(1)
    first.resolve(ok(null))
    await vi.waitFor(() => { expect(remote.session.projections).toHaveBeenCalledTimes(2) })
    await Promise.resolve()
    expect(remote.session.projections).toHaveBeenCalledTimes(2)
  })
})
