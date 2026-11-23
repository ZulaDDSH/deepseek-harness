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

/** Provide the module system face this transport drives: its entry controller's sync and reload. */
function provideModules(ctx: Context, sync: (...args: never[]) => unknown, reload: (...args: never[]) => unknown): void {
  ctx.provide('modules', { entries: { sync, reload } } as ClientModuleLoader)
}

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

it('reads the event stream through the page transport when the shell provides one', async () => {
  const ctx = new Context()
  const sync = vi.fn(async () => {})
  const reload = vi.fn(async () => {})
  provideModules(ctx, sync, reload)
  const graph = { rev: 'r', entries: [], batches: [] }
  const encoder = new TextEncoder()
  let signal: AbortSignal | undefined
  const fetch = vi.fn((_input: string, init: RequestInit) => {
    signal = init.signal ?? undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': connected\n\n'))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'graph', graph })}\n\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'rebuilt', id: 'a', rev: 'r1' })}\n\n`))
        // The tunnel ends the body when the caller aborts.
        init.signal?.addEventListener('abort', () => { controller.close() })
      },
    })
    return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
  })
  vi.stubGlobal('__DSH_TRANSPORT__', { fetch })
  const eventSource = vi.fn()
  vi.stubGlobal('EventSource', eventSource)
  const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
  const fiber = ctx.plugin({ apply, inject })
  try {
    await fiber.await()
    await vi.waitFor(() => { expect(sync).toHaveBeenCalledWith(graph) })
    await vi.waitFor(() => { expect(reload).toHaveBeenCalledWith('a', 'r1') })
    expect(fetch).toHaveBeenCalledWith('plugins/events', expect.objectContaining({ method: 'GET' }))
    expect(eventSource).not.toHaveBeenCalled()
    expect(signal?.aborted).toBe(false)
  } finally {
    await fiber.dispose()
    await ctx.fiber.dispose()
  }
  expect(signal?.aborted).toBe(true)
  await Promise.resolve()
  expect(errors).not.toHaveBeenCalled()
})

it.each([
  ['a refused stream', () => new Response('missing', { status: 404 }), 'plugins/events answered 404'],
  ['a stream without a body', () => new Response(null, { status: 200 }), 'plugins/events answered 200'],
  ['a stream that ends while the plugin runs', () => new Response(': connected\n\n', { status: 200 }), 'plugins/events closed'],
])('reports %s on the page transport', async (_label, respond, message) => {
  const ctx = new Context()
  provideModules(ctx, vi.fn(), vi.fn())
  const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
  vi.stubGlobal('__DSH_TRANSPORT__', { fetch: () => Promise.resolve(respond()) })
  const fiber = ctx.plugin({ apply, inject })
  try {
    await fiber.await()
    await vi.waitFor(() => {
      expect(errors).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(message) as string }))
    })
  } finally {
    await fiber.dispose()
    await ctx.fiber.dispose()
  }
})

it('stays silent when disposal aborts a page-transport request in flight', async () => {
  const ctx = new Context()
  provideModules(ctx, vi.fn(), vi.fn())
  const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
  const fetch = vi.fn((_input: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
  }))
  vi.stubGlobal('__DSH_TRANSPORT__', { fetch })
  const fiber = ctx.plugin({ apply, inject })
  await fiber.await()
  await vi.waitFor(() => { expect(fetch).toHaveBeenCalledOnce() })
  await fiber.dispose()
  await ctx.fiber.dispose()
  await Promise.resolve()
  expect(errors).not.toHaveBeenCalled()
})

it('reopens a browser EventSource the Host closed with an error status, with growing delay', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('navigator', {})
  const ctx = new Context()
  const sync = vi.fn(async () => {})
  provideModules(ctx, sync, vi.fn())
  vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  const sources: Array<{ readyState: number; onerror?: () => void; emit: (value: unknown) => void; closed: boolean }> = []
  vi.stubGlobal('EventSource', class {
    readyState = 0
    closed = false
    onerror: (() => void) | undefined
    private listener: ((event: { data: string }) => void) | undefined
    constructor() { sources.push(this) }
    addEventListener(_name: string, listener: (event: { data: string }) => void) { this.listener = listener }
    emit(value: unknown) { this.listener?.({ data: JSON.stringify(value) }) }
    close() { this.closed = true }
  })
  const fiber = ctx.plugin({ apply, inject })
  try {
    await fiber.await()
    expect(sources).toHaveLength(1)
    sources[0]!.readyState = 2
    sources[0]!.onerror?.()
    await vi.advanceTimersByTimeAsync(999)
    expect(sources).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sources).toHaveLength(2)
    sources[1]!.readyState = 2
    sources[1]!.onerror?.()
    await vi.advanceTimersByTimeAsync(1999)
    expect(sources).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(sources).toHaveLength(3)
    const graph = { rev: 'r', entries: [], batches: [] }
    sources[2]!.emit({ type: 'graph', graph })
    await vi.waitFor(() => { expect(sync).toHaveBeenCalledWith(graph) })
    sources[2]!.readyState = 0
    sources[2]!.onerror?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sources).toHaveLength(3)
  } finally {
    await fiber.dispose()
    await ctx.fiber.dispose()
    vi.useRealTimers()
  }
  expect(sources.every(source => source.closed || source.readyState === 2)).toBe(true)
})

it('retries a page-transport stream that failed or closed, and stops on an authentication refusal', async () => {
  vi.useFakeTimers()
  const ctx = new Context()
  const sync = vi.fn(async () => {})
  provideModules(ctx, sync, vi.fn())
  vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
  const graph = { rev: 'r', entries: [], batches: [] }
  const answers = [
    () => new Response('restarting', { status: 502 }),
    () => new Response(`data: ${JSON.stringify({ type: 'graph', graph })}\n\n`, { status: 200 }),
    () => new Response('denied', { status: 401 }),
  ]
  const fetch = vi.fn(() => Promise.resolve((answers.shift() ?? (() => new Response('', { status: 401 })))()))
  vi.stubGlobal('__DSH_TRANSPORT__', { fetch })
  const fiber = ctx.plugin({ apply, inject })
  try {
    await fiber.await()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(sync).toHaveBeenCalledWith(graph)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetch).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetch).toHaveBeenCalledTimes(3)
  } finally {
    await fiber.dispose()
    await ctx.fiber.dispose()
    vi.useRealTimers()
  }
})
