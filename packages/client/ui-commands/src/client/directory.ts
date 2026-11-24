/**
 * Command-directory cache keyed by session: one entry per served catalog —
 * every session is agent-backed, so `command.list({sessionId})` is the only
 * request fields. Each entry keeps the single-flight / soft-hard invalidation
 * / epoch-guard behavior of the original global cache; the session-key axis
 * is the only extra dimension.
 */
import type { CommandDescriptor } from '@deepseek-ai/dsh-commands/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { resolveCommand } from '@deepseek-ai/dsh-commands/builtin'

export type { CommandDescriptor } from '@deepseek-ai/dsh-commands/types'

/**
 * cold = never pulled; pending = pull in flight with nothing servable;
 * ready = snapshot serving (a soft-invalidate repull keeps this status);
 * failed = last winning pull rejected, snapshot dropped.
 */
export type DirectoryStatus = 'cold' | 'pending' | 'ready' | 'failed'

/** Injected pull (the service binds command.list off the root connection). */
export type FetchCommands = (sessionId: SessionId) => Promise<readonly CommandDescriptor[]>

/** One session key's cache cell. */
class Entry {
  state: DirectoryStatus = 'cold'
  commands: readonly CommandDescriptor[] = []
  busy = false
  idle: Promise<void> = Promise.resolve()
  rerun = false
  lastError: unknown
  waiters: Array<() => void> = []
}

const MAX_ENTRIES = 64

/** The session-keyed directory cache. Plain class — the owning service wires events and RPC. */
export class CommandDirectory {
  private readonly entries = new Map<SessionId, Entry>()

  constructor(private readonly fetchCommands: FetchCommands) {}

  /**
   * Current cache status for one session.
   * @param sessionId - session key.
   * @returns the entry status (cold when never touched).
   */
  status(sessionId: SessionId): DirectoryStatus {
    return this.entries.get(sessionId)?.state ?? 'cold'
  }

  /**
   * Synchronous command lookup over one Session's ready catalog; exact names precede localized aliases.
   * @param sessionId - session key.
   * @param name - typed command spelling without the leading slash.
   * @returns the descriptor, or undefined when absent or the entry is not ready.
   */
  resolve(sessionId: SessionId, name: string): CommandDescriptor | undefined {
    const entry = this.entries.get(sessionId)
    if (entry === undefined || entry.state !== 'ready') return undefined
    return resolveCommand(name, entry.commands)
  }

  /** Soft invalidation (commands-changed): background repull on every touched key; ready snapshots keep serving. */
  invalidateAll(): void {
    for (const [key, entry] of this.entries) {
      if (entry.state === 'ready' || entry.state === 'pending') void this.refresh(key)
    }
  }

  /**
   * Drop one Session's obsolete composition-specific snapshot and prewarm its replacement.
   * @param sessionId - Session whose effective command composition changed.
   */
  resetSession(sessionId: SessionId): void {
    const entry = this.entry(sessionId)
    entry.state = 'cold'
    entry.commands = []
    entry.lastError = undefined
    void this.refresh(sessionId)
  }

  /**
   * Hard reset on reconnect: every entry drops its snapshot (the agent world
   * may have changed shape across the generation) and prewarms.
   */
  resetConnected(): void {
    for (const [key, entry] of this.entries) {
      entry.state = 'cold'
      entry.commands = []
      void this.refresh(key)
    }
  }

  /**
   * Fire-and-forget prewarm of one session (the command source's scope-birth
   * warm hook lands here).
   * @param sessionId - session key.
   */
  warm(sessionId: SessionId): void {
    const entry = this.entry(sessionId)
    if (entry.state === 'cold' || entry.state === 'failed') void this.refresh(sessionId)
  }

  /**
   * Request one coalesced pull for one session.
   * @param sessionId - session key.
   * @returns settled when the entry has no pull left to run.
   */
  refresh(sessionId: SessionId): Promise<void> {
    const entry = this.entry(sessionId)
    if (entry.state !== 'ready') entry.state = 'pending'
    if (entry.busy) {
      entry.rerun = true
      return entry.idle
    }
    entry.busy = true
    entry.idle = this.pull(sessionId, entry)
    return entry.idle
  }

  private async pull(sessionId: SessionId, entry: Entry): Promise<void> {
    try {
      do {
        entry.rerun = false
        try {
          const commands = await this.fetchCommands(sessionId)
          if (entry.rerun) continue
          entry.commands = commands
          entry.state = 'ready'
          entry.lastError = undefined
        } catch (error) {
          if (entry.rerun) continue
          entry.commands = []
          entry.state = 'failed'
          entry.lastError = error
        }
        notifyWaiters(entry)
      } while (entry.rerun)
    } finally { entry.busy = false }
  }

  /**
   * Strong-wait until one session's catalog is servable (the enter-
   * adjudication "directory must be reached" rule): ready returns at once;
   * cold/failed launch a fresh pull; pending joins the flying one. Rejects
   * when the awaited pull fails or the signal aborts.
   * @param sessionId - session key.
   * @param signal - attempt-scoped abort (the SubmitAttempt signal).
   * @returns the hot command snapshot.
   */
  async ensureReady(sessionId: SessionId, signal: AbortSignal): Promise<readonly CommandDescriptor[]> {
    while (true) {
      const entry = this.entry(sessionId)
      if (entry.state === 'ready') return entry.commands
      if (entry.state !== 'pending') void this.refresh(sessionId)
      await settled(entry, signal)
      if (entry.state === 'failed') {
        throw new Error(`command directory warmup failed: ${entry.lastError instanceof Error ? entry.lastError.message : String(entry.lastError)}`)
      }
      // Still pending (the awaited pull was superseded) → wait for the winner.
    }
  }

  private entry(sessionId: SessionId): Entry {
    let entry = this.entries.get(sessionId)
    if (entry === undefined) {
      entry = new Entry()
      this.entries.set(sessionId, entry)
      if (this.entries.size > MAX_ENTRIES) this.evictIdle(entry)
    }
    return entry
  }

  private evictIdle(keep: Entry): void {
    for (const [key, candidate] of this.entries) {
      if (candidate === keep || candidate.busy || candidate.waiters.length > 0) continue
      this.entries.delete(key)
      return
    }
  }
}

/** One settlement tick for one entry: resolves at the next winning publish, rejects on abort. */
function settled(entry: Entry, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    const waiter = (): void => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const onAbort = (): void => {
      entry.waiters = entry.waiters.filter(w => w !== waiter)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    entry.waiters.push(waiter)
  })
}

function notifyWaiters(entry: Entry): void {
  const woken = entry.waiters
  entry.waiters = []
  for (const wake of woken) wake()
}

/** Normalize an abort into an Error rejection. */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('command directory wait aborted')
}
