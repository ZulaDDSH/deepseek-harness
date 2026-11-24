/** Web SSE transport for page-owned client entry reconciliation; one leader tab per browser holds the events connection. */
import type { Context } from '@deepseek-ai/cordis'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import type { PluginsEventParseResult } from '../events.ts'
import { EVENTS_ROUTE, parsePluginsEventFrame } from '../events.ts'

export type { PluginsEventFrame } from '../events.ts'

/** Cordis plugin name. */
export const name = 'client-hmr'

/** Required service: the client module system whose entry controller handles received frames. */
export const inject = ['modules']

/** Web Locks name electing the one tab per browser that holds `/plugins/events`. */
const LEADER_LOCK = 'dsh-hmr-events'
/** BroadcastChannel name relaying leader frames and joining-tab hellos. */
const CHANNEL = 'dsh-hmr-events'

const RETRY_MIN_MS = 1000
const RETRY_MAX_MS = 30_000
const EVENT_SOURCE_CLOSED = 2

class AuthRefusedError extends Error {}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

type ChannelMessage = { type: 'hello' } | { type: 'frame'; data: string }

/** Request carrier a shell installs when it owns the page transport, such as the worker preview's tunnel. */
type PageTransportFetch = (input: string, init: RequestInit) => Promise<Response>

/** Page global carrying the shell transport; absent in the served web app. */
interface PageTransportGlobal {
  __DSH_TRANSPORT__?: { fetch?: PageTransportFetch }
}

/**
 * Read the document-relative events route through a shell-owned transport until it closes or `signal` aborts.
 * @param fetch - The shell's request carrier.
 * @param signal - Aborts the stream when the plugin disposes.
 * @param receive - Handles one SSE `data` payload.
 * @throws Error when the Host refuses the stream or the stream ends while the plugin is active.
 */
async function readPageTransportEvents(fetch: PageTransportFetch, signal: AbortSignal, receive: (data: string) => void): Promise<void> {
  const response = await fetch(EVENTS_ROUTE, { method: 'GET', headers: { accept: 'text/event-stream' }, signal })
  if (response.status === 401 || response.status === 403) {
    throw new AuthRefusedError(`client-hmr: ${EVENTS_ROUTE} answered ${String(response.status)}; client graph changes stop until the page reloads`)
  }
  if (!response.ok || response.body === null) {
    throw new Error(`client-hmr: ${EVENTS_ROUTE} answered ${String(response.status)}`)
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream()).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    receive(value.data)
  }
  if (!signal.aborted) throw new Error(`client-hmr: ${EVENTS_ROUTE} closed; client graph changes stop until the page reloads`)
}

/**
 * Forward graph snapshots and rebuilds to the page's shared serial controller. The event stream arrives through the
 * shell transport when the page has one, otherwise through the browser `EventSource`.
 * @param ctx - Plugin context with the client module system.
 */
export function apply(ctx: Context): void {
  const entries = ctx.modules.entries
  const handle = (frame: Extract<PluginsEventParseResult, { kind: 'frame' }>['frame']): void => {
    const run = frame.type === 'graph'
      ? Promise.resolve().then(() => entries.sync(frame.graph))
      : entries.reload(frame.id, frame.rev)
    void run.catch((error: unknown) => { ctx.logger.error(error) })
  }
  const receive = (data: string): void => {
    let value: unknown
    try {
      value = JSON.parse(data)
    } catch {
      // Wire boundary: a malformed transport frame is dropped loudly.
      ctx.logger.warn(`client-hmr: unparseable event frame: ${data}`)
      return
    }
    const parsed = parsePluginsEventFrame(value)
    if (parsed.kind === 'invalid') {
      ctx.logger.warn(`client-hmr: invalid event frame: ${data}`)
    } else if (parsed.kind === 'frame') {
      handle(parsed.frame)
    }
  }
  const connect = (onData: (data: string) => void): (() => void) => {
    let source: EventSource | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = RETRY_MIN_MS
    const open = (): void => {
      timer = undefined
      const next = new EventSource(EVENTS_ROUTE)
      source = next
      next.addEventListener('message', (event: MessageEvent<string>) => {
        delay = RETRY_MIN_MS
        onData(event.data)
      })
      next.onerror = () => {
        if (source !== next || next.readyState !== EVENT_SOURCE_CLOSED) return
        ctx.logger.warn(`client-hmr: ${EVENTS_ROUTE} refused the stream; retrying in ${String(delay)} ms`)
        timer = setTimeout(open, delay)
        delay = Math.min(delay * 2, RETRY_MAX_MS)
      }
    }
    open()
    return () => {
      clearTimeout(timer)
      source?.close()
      source = undefined
    }
  }

  ctx.effect(() => {
    const transport = (globalThis as PageTransportGlobal).__DSH_TRANSPORT__
    const carrier = transport?.fetch
    if (carrier !== undefined) {
      const controller = new AbortController()
      void (async () => {
        let delay = RETRY_MIN_MS
        const onData = (data: string): void => {
          delay = RETRY_MIN_MS
          receive(data)
        }
        const stopped = (): boolean => controller.signal.aborted
        while (!stopped()) {
          try {
            await readPageTransportEvents(carrier, controller.signal, onData)
          } catch (error) {
            if (stopped()) return
            ctx.logger.error(error)
            if (error instanceof AuthRefusedError) return
          }
          await wait(delay, controller.signal)
          delay = Math.min(delay * 2, RETRY_MAX_MS)
        }
      })()
      return () => { controller.abort() }
    }
    if (!('locks' in navigator) || typeof BroadcastChannel === 'undefined') return connect(receive)
    const channel = new BroadcastChannel(CHANNEL)
    const abort = new AbortController()
    let reconnect: (() => void) | undefined
    channel.addEventListener('message', (event: MessageEvent<ChannelMessage>) => {
      if (event.data.type === 'frame') receive(event.data.data)
      else reconnect?.()
    })
    void navigator.locks.request(LEADER_LOCK, { signal: abort.signal }, () => new Promise<void>((resolve) => {
      const relay = (data: string): void => {
        channel.postMessage({ type: 'frame', data } satisfies ChannelMessage)
        receive(data)
      }
      let close = connect(relay)
      reconnect = () => { close(); close = connect(relay) }
      abort.signal.addEventListener('abort', () => { reconnect = undefined; close(); resolve() }, { once: true })
    })).catch((error: unknown) => { if (!abort.signal.aborted) ctx.logger.error(error) })
    channel.postMessage({ type: 'hello' } satisfies ChannelMessage)
    return () => { abort.abort(); channel.close() }
  }, 'client-hmr: event source')
}
