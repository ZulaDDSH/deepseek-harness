import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime, { foldSubagentDescriptor, snapshotSubagentDescriptor, SUBAGENT_DESCRIPTOR_VERSION } from '../src/index.ts'
import { subagentIdentityProjectionDefinition } from '../src/projection.ts'
import { mountWorkingDirectoryFixture } from './working-directory-fixture.ts'

function descriptorEvent(data: unknown, seq = 4): SessionEvent {
  return { type: 'subagent/descriptor', seq, time: 1, data } as SessionEvent
}

function identityOf(events: SessionEvent[]) {
  let state = subagentIdentityProjectionDefinition.init()
  for (const item of events) state = subagentIdentityProjectionDefinition.apply(state, item)
  return subagentIdentityProjectionDefinition.wire.view(state)
}

describe('route-pinned subagent descriptors', () => {
  it('loads a descriptor written before routePinned existed without a pin', () => {
    const oneShot = { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'one-shot', provider: 'spawn', label: 'old child' }
    const continuable = { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'spawn', label: 'old child' }
    expect(foldSubagentDescriptor([descriptorEvent(oneShot)])).toEqual(oneShot)
    expect(foldSubagentDescriptor([descriptorEvent(continuable)])).toEqual(continuable)
    expect(identityOf([descriptorEvent(oneShot)])).toEqual({ mode: 'one-shot', label: 'old child', seq: 4 })
    expect(identityOf([descriptorEvent(continuable)])).toEqual({ mode: 'continuable', label: 'old child', seq: 4 })
  })

  it('round-trips a pinned descriptor into the identity projection', () => {
    const pinned = snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'spawn', label: 'role child', routePinned: true })
    expect(pinned).toMatchObject({ routePinned: true })
    expect(foldSubagentDescriptor([descriptorEvent(pinned)])).toEqual(pinned)
    expect(identityOf([descriptorEvent(pinned)])).toEqual({ mode: 'one-shot', label: 'role child', seq: 4, routePinned: true })
    const pinnedContinuable = snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label: 'role child', routePinned: true })
    expect(identityOf([descriptorEvent(pinnedContinuable)])).toMatchObject({ mode: 'continuable', routePinned: true })
  })

  it('writes no routePinned key for an unpinned child', () => {
    expect(snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'spawn' })).not.toHaveProperty('routePinned')
  })

  it('rejects a routePinned value other than true and resets the identity', () => {
    const bad = { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'one-shot', provider: 'spawn', routePinned: false }
    expect(() => foldSubagentDescriptor([descriptorEvent(bad)])).toThrow('routePinned must be true when present')
    expect(identityOf([descriptorEvent({ ...bad, routePinned: undefined }), descriptorEvent(bad, 5)])).toBeNull()
  })

  it('serves a version-3 identity row and ignores a version-2 checkpoint row so it refolds', async () => {
    expect(subagentIdentityProjectionDefinition.stateVersion).toBe(3)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    const identity = { mode: 'one-shot' as const, seq: SessionSeq(4), routePinned: true as const }
    const current = ctx.sessionProjections.viewCheckpoint({ subagent: { ver: 3, seq: SessionSeq(4), val: { identity } } }, ['subagent'])
    expect(current.subagent).toEqual(identity)
    const stale = ctx.sessionProjections.viewCheckpoint({ subagent: { ver: 2, seq: SessionSeq(4), val: { identity: { mode: 'one-shot', seq: SessionSeq(4) } } } }, ['subagent'])
    expect(stale.subagent).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
