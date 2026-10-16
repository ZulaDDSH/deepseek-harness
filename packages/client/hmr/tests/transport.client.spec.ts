/** Web transport delegates module and entry changes to the page-owned controller. */
import { Context } from '@deepseek-ai/cordis'
import type { ClientModuleLoader } from '@deepseek-ai/dsh-client-modules/client'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

type Listener = (event: { data: unknown }) => void

/** In-file Web Locks fake: one holder at a time, queued requests granted in order. */
class FakeLocks {
  private held = false
  private readonly queue: Array<() => void> = []
  request<T>(_name: string, options: { signal: AbortSignal }, callback: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        this.held = true
        callback().then(resolve, reject).finally(() => {
          this.held = false
          this.queue.shift()?.()
        })
      }
      if (!this.held) { start(); return }
      const grant = (): void => {
        options.signal.removeEventListener('abort', onAbort)
        start()
      }
      const onAbort = (): void => {
        const index = this.queue.indexOf(grant)
        if (index >= 0) this.queue.splice(index, 1)
        const reason: unknown = options.signal.reason
        reject(reason instanceof Error ? reason : new Error('lock request aborted'))
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
      this.queue.push(grant)
    })
  }
}

/** In-file BroadcastChannel fake: messages reach every other open instance, never the sender. */
class FakeChannel {
  static readonly open = new Set<FakeChannel>()
  private readonly listeners: Listener[] = []
  constructor() { FakeChannel.open.add(this) }
  addEventListener(_type: 'message', listener: Listener): void { this.listeners.push(listener) }
  postMessage(message: unknown): void {
    queueMicrotask(() => {
      for (const channel of FakeChannel.open) {
        if (channel === this) continue
        for (const listener of channel.listeners) listener({ data: structuredClone(message) })
      }
    })
  }
  close(): void { FakeChannel.open.delete(this) }
}

/** In-file EventSource fake recording every connection and its captured listener. */
class FakeEventSource {
  static readonly instances: FakeEventSource[] = []
  closed = false
  private listener: ((event: { data: string }) => void) | undefined
  constructor() { FakeEventSource.instances.push(this) }
  addEventListener(_name: string, listener: (event: { data: string }) => void): void { this.listener = listener }
  emit(value: unknown): void { this.listener?.({ data: JSON.stringify(value) }) }
  close(): void { this.closed = true }
}

/** Provide the module loader's entry controller, the only surface the transport reads. */
function provideEntries(ctx: Context, sync: object, reload: object): void {
  ctx.provide('modules', { entries: { sync, reload } } as unknown as ClientModuleLoader)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  FakeChannel.open.clear()
  FakeEventSource.instances.length = 0
})

it('forwards full graphs and rebuilt frames, contains wire errors and closes its EventSource', async () => {
  vi.stubGlobal('navigator', {})
  const ctx = new Context()
  const sync = vi.fn(async () => {})
  const reload = vi.fn(async () => {})
  provideEntries(ctx, sync, reload)
  const warnings = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
  let receive!: (event: { data: string }) => void
  const close = vi.fn()
  vi.stubGlobal('EventSource', class {
    close = close
    addEventListener(_name: string, listener: typeof receive) { receive = listener }
  })
  const fiber = ctx.plugin({ apply, inject })
  try {
    await fiber.await()
    const graph = { rev: 'r', entries: [], batches: [] }
    receive({ data: JSON.stringify({ type: 'graph', graph }) })
    receive({ data: JSON.stringify({ type: 'rebuilt', id: 'a', rev: 'r1' }) })
    await vi.waitFor(() => { expect(sync).toHaveBeenCalledWith(graph) })
    expect(reload).toHaveBeenCalledWith('a', 'r1')
    receive({ data: '{' })
    receive({ data: JSON.stringify({ type: 'graph', graph: null }) })
    receive({ data: JSON.stringify({ type: 'future' }) })
    expect(warnings).toHaveBeenCalledTimes(2)
    sync.mockRejectedValueOnce(new Error('invalid graph'))
    receive({ data: JSON.stringify({ type: 'graph', graph: {} }) })
    await vi.waitFor(() => { expect(errors).toHaveBeenCalledWith(expect.objectContaining({ message: 'invalid graph' })) })
  } finally {
    await fiber.dispose()
    await ctx.fiber.dispose()
  }
  expect(close).toHaveBeenCalledOnce()
})

it('shares one EventSource across tabs and hands it over when the leader closes', async () => {
  vi.stubGlobal('navigator', { locks: new FakeLocks() })
  vi.stubGlobal('BroadcastChannel', FakeChannel)
  vi.stubGlobal('EventSource', FakeEventSource)
  const openSources = (): FakeEventSource[] => FakeEventSource.instances.filter(source => !source.closed)
  const makeTab = () => {
    const ctx = new Context()
    const entries = { sync: vi.fn(async () => {}), reload: vi.fn(async () => {}) }
    provideEntries(ctx, entries.sync, entries.reload)
    return { ctx, entries, fiber: ctx.plugin({ apply, inject }) }
  }
  const tab1 = makeTab()
  const tab2 = makeTab()
  await tab1.fiber.await()
  await tab2.fiber.await()

  await vi.waitFor(() => { expect(FakeEventSource.instances).toHaveLength(2) })
  await vi.waitFor(() => { expect(openSources()).toHaveLength(1) })
  const [leaderSource] = openSources()
  if (!leaderSource) throw new Error('no open leader source')
  const graph = { rev: 'r', entries: [], batches: [] }
  leaderSource.emit({ type: 'graph', graph })
  await vi.waitFor(() => {
    expect(tab1.entries.sync).toHaveBeenCalledWith(graph)
    expect(tab2.entries.sync).toHaveBeenCalledWith(graph)
  })

  await tab1.fiber.dispose()
  await tab1.ctx.fiber.dispose()
  await vi.waitFor(() => { expect(openSources()).toHaveLength(1) })
  const [handover] = openSources()
  if (!handover) throw new Error('no open handover source')
  expect(handover).not.toBe(leaderSource)
  handover.emit({ type: 'rebuilt', id: 'a', rev: 'r1' })
  await vi.waitFor(() => { expect(tab2.entries.reload).toHaveBeenCalledWith('a', 'r1') })

  await tab2.fiber.dispose()
  await tab2.ctx.fiber.dispose()
  expect(openSources()).toHaveLength(0)
})
