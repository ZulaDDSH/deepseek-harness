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
    ['failed', true], ['saved', false], ['unavailable', true], ['pending', false], [undefined, false],
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
