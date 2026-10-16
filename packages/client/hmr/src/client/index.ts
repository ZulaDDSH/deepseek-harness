/** Web SSE transport for page-owned client entry reconciliation; one leader tab per browser holds the events connection. */
import type { Context } from '@deepseek-ai/cordis'
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

type ChannelMessage = { type: 'hello' } | { type: 'frame'; data: string }

/**
 * Forward graph snapshots and rebuilds to the page's shared serial controller.
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
    const source = new EventSource(EVENTS_ROUTE)
    source.addEventListener('message', (event: MessageEvent<string>) => { onData(event.data) })
    return () => { source.close() }
  }

  ctx.effect(() => {
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
