/** Trajectory Host inspector retaining tool values only for live Session instances. */
import { addAbortListener } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tool-executor-ptc'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionToolResultRequest, SessionToolResultValue } from './types.ts'

export type { SessionToolResultRequest, SessionToolResultValue } from './types.ts'

interface LiveResults {
  readonly values: Map<ToolCallId | number, JsonValue>
  readonly sizes: Map<ToolCallId | number, number>
  readonly listeners: Set<(seq?: number) => void>
  bytes: number
}

function emptyResults(): LiveResults {
  return { values: new Map(), sizes: new Map(), listeners: new Set(), bytes: 0 }
}

function jsonBytesUpTo(value: JsonValue, limit: number): number {
  let bytes = 0
  const pending: JsonValue[] = [value]
  for (let next = pending.pop(); next !== undefined && bytes <= limit; next = pending.pop()) {
    if (typeof next === 'string') bytes += Buffer.byteLength(next) + 2
    else if (next === null || typeof next !== 'object') bytes += String(next).length
    else if (Array.isArray(next)) {
      bytes += 2 + next.length
      for (const member of next) pending.push(member)
    } else {
      for (const [key, member] of Object.entries(next)) {
        bytes += Buffer.byteLength(key) + 4
        pending.push(member)
      }
    }
  }
  return bytes
}

function clearResults(state: LiveResults): void {
  state.values.clear()
  state.sizes.clear()
  state.bytes = 0
}

/** Count limit for each live Session's transient tool results. */
export interface Config {
  /** Maximum retained results per Session, including values awaiting a result event. */
  maxResultsPerSession: number
  /** A value whose JSON text is longer than this many bytes must not be retained. */
  maxValueBytes: number
  /** Retained JSON bytes per Session must not exceed this. */
  maxBytesPerSession: number
  /** Retained JSON bytes over all Sessions must not exceed this. */
  maxTotalBytes: number
}

/** Read-only Remote inspection of tool values produced in this Session lifetime. */
export default class SessionToolResults extends TypertRemoteService {
  static inject = ['sessions', 'typert']
  static Config: z<Partial<Config>, Config> = z.object({
    maxResultsPerSession: z.natural().min(1).default(1000),
    maxValueBytes: z.natural().min(1).default(4 * 1024 * 1024),
    maxBytesPerSession: z.natural().min(1).default(32 * 1024 * 1024),
    maxTotalBytes: z.natural().min(1).default(256 * 1024 * 1024),
  })
  private readonly results = new Map<Session, LiveResults>()
  private readonly lifetime = new AbortController()

  /**
   * @param ctx - Owner of the live Session registry and tool result notifications.
   * @param config - Validated per-Session retention limit.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'sessionToolResults', { namespace: 'toolResults' })
    ctx.on('tools/result', (exec, result) => {
      const session = exec.agent?.session
      if (result.isError || session === undefined || ctx.sessions.get(session.id) !== session) return
      const size = jsonBytesUpTo(result.value, config.maxValueBytes)
      if (size > config.maxValueBytes) return
      const state = this.forSession(session)
      state.bytes -= state.sizes.get(exec.callId) ?? 0
      state.values.delete(exec.callId)
      state.sizes.delete(exec.callId)
      const evictOldest = (): void => {
        for (const oldest of state.values.keys()) {
          state.values.delete(oldest)
          state.bytes -= state.sizes.get(oldest) ?? 0
          state.sizes.delete(oldest)
          if (typeof oldest === 'number') for (const listener of state.listeners) listener(oldest)
          break
        }
      }
      while (state.values.size > 0 && (state.values.size >= config.maxResultsPerSession
        || state.bytes + size > config.maxBytesPerSession
        || this.totalBytes() + size > config.maxTotalBytes)) evictOldest()
      if (this.totalBytes() + size > config.maxTotalBytes) return
      state.values.set(exec.callId, result.value)
      state.sizes.set(exec.callId, size)
      state.bytes += size
    }, { global: true })
    ctx.on('session/event', (session, event) => {
      const callId = event.type === 'tool/result' ? event.data.message.toolCallId
        : event.type === 'tool/ptc-dispatch' ? event.data.subCallId : undefined
      if (callId === undefined) return
      const state = this.results.get(session)
      const value = state?.values.get(callId)
      if (state === undefined || value === undefined) return
      const size = state.sizes.get(callId) ?? 0
      state.values.delete(callId)
      state.sizes.delete(callId)
      state.values.set(event.seq, value)
      state.sizes.set(event.seq, size)
      for (const listener of state.listeners) listener(event.seq)
    }, { global: true })
    ctx.on('session/disposed', (session) => {
      const state = this.results.get(session)
      if (state === undefined) return
      this.results.delete(session)
      clearResults(state)
      for (const listener of state.listeners) listener()
    }, { global: true })
    ctx.effect(() => () => {
      this.lifetime.abort()
      for (const state of this.results.values()) clearResults(state)
      this.results.clear()
    }, 'tool-results: live values and followers')
  }

  private totalBytes(): number {
    let total = 0
    for (const state of this.results.values()) total += state.bytes
    return total
  }

  private forSession(session: Session): LiveResults {
    let state = this.results.get(session)
    if (state === undefined) {
      state = emptyResults()
      this.results.set(session, state)
    }
    return state
  }

  private forRequest(request: SessionToolResultRequest): LiveResults {
    const session = this.ctx.sessions.get(request.sessionId)
    return session === undefined ? emptyResults() : this.forSession(session)
  }

  /**
   * Observe one committed result without loading a Session or reading its history.
   * Values disappear on count eviction or when the exact Session instance leaves
   * the registry. A cold read stays unavailable; opening a new stream observes
   * the current instance. Inspection does not extend a result's retention.
   * @param request - Authorized Session identity and durable result event sequence.
   * @param signal - Remote consumer lifetime.
   * @returns Current availability and changes until cancellation or service disposal.
   */
  @Remote({ mode: 'stream' })
  async *watch(request: SessionToolResultRequest, signal: AbortSignal): AsyncIterable<SessionToolResultValue> {
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    if (lifetime.aborted) return
    const state = this.forRequest(request)
    let update = Promise.withResolvers<void>()
    const changed = (seq?: number): void => {
      if (seq === undefined || seq === request.seq) update.resolve()
    }
    state.listeners.add(changed)
    using _cancellation = addAbortListener(lifetime, () => { update.resolve() })
    try {
      while (!lifetime.aborted) {
        const value = state.values.get(request.seq)
        yield value === undefined ? { available: false } : { available: true, value }
        await update.promise
        update = Promise.withResolvers<void>()
      }
    } finally {
      state.listeners.delete(changed)
    }
  }
}
