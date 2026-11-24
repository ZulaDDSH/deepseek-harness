import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, it, vi } from 'vitest'
import { ModelDirectory } from '../src/client/directory.ts'

interface Call { readonly model: string; readonly settle: () => void }

function fixture() {
  const calls: Call[] = []
  const host: string[] = []
  const selectModel = vi.fn((request: { model: string }) => new Promise((resolve) => {
    calls.push({
      model: request.model,
      settle: () => { host.push(request.model); resolve({ ok: true, value: { selected: request } }) },
    })
  }))
  const catalog = {
    store: createSnapshotStore({ status: 'loading', value: null, error: null }),
    reasoningFor: () => undefined,
    nameFor: () => undefined,
  }
  const projected = { subscribe: () => () => {}, getSnapshot: () => undefined }
  const directory = new ModelDirectory(
    { selectModel } as never, 'session' as SessionId, () => true, catalog as never, projected as never, () => false,
  )
  const select = (model: string) => directory.select({ provider: 'p', model })
  return { calls, host, selectModel, directory, select }
}

describe('ModelDirectory selection ordering', () => {
  it('sends a later choice only after the earlier request settles, so the Host ends on the latest choice', async () => {
    const { calls, host, select, directory } = fixture()
    const first = select('a')
    const second = select('b')
    await Promise.resolve()
    expect(calls.map(call => call.model)).toEqual(['a'])
    calls[0]?.settle()
    await vi.waitFor(() => { expect(calls.map(call => call.model)).toEqual(['a', 'b']) })
    calls[1]?.settle()
    await Promise.all([first, second])
    expect(host).toEqual(['a', 'b'])
    expect(directory.store.getSnapshot()).toMatchObject({ pending: null, error: null })
  })

  it('does not send a queued choice that a newer choice replaced', async () => {
    const { calls, host, select } = fixture()
    const first = select('a')
    const skipped = select('b')
    const last = select('c')
    calls[0]?.settle()
    await vi.waitFor(() => { expect(calls.map(call => call.model)).toEqual(['a', 'c']) })
    calls[1]?.settle()
    await expect(Promise.all([first, skipped, last])).resolves.toEqual([
      { ok: true, value: undefined }, { ok: true, value: undefined }, { ok: true, value: undefined },
    ])
    expect(host).toEqual(['a', 'c'])
  })

  it('sends immediately when nothing is in flight and after a connection reset abandons the wait', async () => {
    const { calls, select, directory, selectModel } = fixture()
    void select('a')
    expect(selectModel).toHaveBeenCalledOnce()
    directory.resetConnected()
    void select('b')
    await Promise.resolve()
    expect(calls.map(call => call.model)).toEqual(['a', 'b'])
  })
})

describe('ModelDirectory default persistence outcome', () => {
  it.each([
    ['failed', true], ['saved', false], ['unavailable', true], [undefined, false],
  ] as const)('defaultSave %s sets the store warning to %s and the next selection clears it', async (outcome, warned) => {
    const sessions = {
      selectModel: vi.fn(async (request: { model: string }) => ({
        ok: true, value: { selected: request, ...request.model === 'a' && outcome !== undefined ? { defaultSave: outcome } : {} },
      })),
    }
    const catalog = {
      store: createSnapshotStore({ status: 'loading', value: null, error: null }),
      reasoningFor: () => undefined, nameFor: () => undefined,
    }
    const directory = new ModelDirectory(
      sessions as never, 'session' as SessionId, () => true, catalog as never,
      { subscribe: () => () => {}, getSnapshot: () => undefined } as never, () => false,
    )
    await directory.select({ provider: 'p', model: 'a' })
    expect(directory.store.getSnapshot().defaultNotSaved === true).toBe(warned)
    catalog.store.update(() => {})
    expect(directory.store.getSnapshot().defaultNotSaved === true).toBe(warned)
    await directory.select({ provider: 'p', model: 'b' })
    expect(directory.store.getSnapshot().defaultNotSaved).toBeUndefined()
  })
})

describe('ModelDirectory late default save', () => {
  function lateFixture(outcomes: Array<'pending' | 'saved' | 'failed' | 'unavailable' | 'error'>) {
    const gates = outcomes.map(() => Promise.withResolvers<undefined>())
    let polls = 0
    const defaultSaveOutcome = vi.fn(async () => {
      const index = polls++
      await (gates[index]?.promise ?? new Promise<undefined>(() => {}))
      const outcome = outcomes[index] ?? 'pending'
      return outcome === 'error'
        ? { ok: false as const, error: { code: 'session/default-save-unknown', message: 'gone' } }
        : { ok: true as const, value: { defaultSave: outcome } }
    })
    const sessions = {
      selectModel: vi.fn(async (request: { model: string }) => ({
        ok: true, value: { selected: request, defaultSave: 'pending', defaultSaveId: `save-${request.model}` },
      })),
      defaultSaveOutcome,
    }
    const catalog = {
      store: createSnapshotStore({ status: 'loading', value: null, error: null }),
      reasoningFor: () => undefined, nameFor: () => undefined,
    }
    const directory = new ModelDirectory(
      sessions as never, 'session' as SessionId, () => true, catalog as never,
      { subscribe: () => () => {}, getSnapshot: () => undefined } as never, () => false,
    )
    const release = async (index: number) => {
      gates[index]?.resolve(undefined)
      await vi.waitFor(() => { expect(defaultSaveOutcome.mock.calls.length).toBeGreaterThanOrEqual(Math.min(index + 1, outcomes.length)) })
    }
    return { directory, catalog, sessions, defaultSaveOutcome, release, gates }
  }

  it('shows a saving state, keeps asking while the Host reports pending, and ends on a late success without a warning', async () => {
    const { directory, catalog, sessions, release, gates } = lateFixture(['pending', 'saved'])
    await directory.select({ provider: 'p', model: 'a' })
    expect(directory.store.getSnapshot()).toMatchObject({ defaultLate: 'saving' })
    expect(directory.store.getSnapshot().defaultNotSaved).toBeUndefined()
    expect(sessions.defaultSaveOutcome).toHaveBeenCalledWith({ sessionId: 'session', saveId: 'save-a' })
    catalog.store.update(() => {})
    expect(directory.store.getSnapshot().defaultLate).toBe('saving')
    gates[0]?.resolve(undefined)
    await vi.waitFor(() => { expect(sessions.defaultSaveOutcome).toHaveBeenCalledTimes(2) })
    expect(directory.store.getSnapshot().defaultLate).toBe('saving')
    await release(1)
    await vi.waitFor(() => { expect(directory.store.getSnapshot().defaultLate).toBe('saved') })
    expect(directory.store.getSnapshot().defaultNotSaved).toBeUndefined()
    await directory.select({ provider: 'p', model: 'b' })
    expect(directory.store.getSnapshot().defaultLate).toBe('saving')
  })

  it.each(['failed', 'unavailable', 'error'] as const)('turns a late %s outcome into the not-saved state', async (outcome) => {
    const { directory, release } = lateFixture([outcome])
    await directory.select({ provider: 'p', model: 'a' })
    await release(0)
    await vi.waitFor(() => { expect(directory.store.getSnapshot().defaultNotSaved).toBe(true) })
    expect(directory.store.getSnapshot().defaultLate).toBeUndefined()
  })

  it('drops a follow-up that a newer selection, a connection reset, or teardown superseded', async () => {
    const newer = lateFixture(['failed'])
    await newer.directory.select({ provider: 'p', model: 'a' })
    void newer.directory.select({ provider: 'p', model: 'b' })
    await newer.release(0)
    await Promise.resolve()
    expect(newer.directory.store.getSnapshot().defaultNotSaved).toBeUndefined()

    const reset = lateFixture(['failed'])
    await reset.directory.select({ provider: 'p', model: 'a' })
    reset.directory.resetConnected()
    await reset.release(0)
    await Promise.resolve()
    expect(reset.directory.store.getSnapshot()).not.toHaveProperty('defaultNotSaved')
    expect(reset.directory.store.getSnapshot()).not.toHaveProperty('defaultLate')

    const disposed = lateFixture(['failed'])
    await disposed.directory.select({ provider: 'p', model: 'a' })
    disposed.directory.dispose()
    await disposed.release(0)
    await Promise.resolve()
    expect(disposed.directory.store.getSnapshot().defaultNotSaved).toBeUndefined()
  })
})
