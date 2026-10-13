/** One observable answer to "did my last settings change stick?" across every Host-backed form. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Outcome of the Host settings writes the user has just made. */
export interface SettingsSaveStatus {
  /** `saving` while any write is queued or in flight, then `saved` or `failed` until the notice expires. */
  state: 'idle' | 'saving' | 'saved' | 'failed'
}

/** How long a successful write stays announced. */
export const SAVED_NOTICE_MS = 2_500
/** How long a refused write stays announced; failures stay longer so they are not missed. */
export const FAILED_NOTICE_MS = 8_000

/**
 * Folds every tracked write into one status: a batch settles to `failed` when
 * any of its writes failed, otherwise `saved`, and the notice then expires to
 * `idle`.
 */
export class SaveStatusTracker {
  private readonly store = createSnapshotStore<SettingsSaveStatus>({ state: 'idle' })
  private pending = 0
  private anyFailed = false
  private timer: ReturnType<typeof setTimeout> | undefined

  /** Current status for renderer-bound hooks. */
  readonly status: ObservableSnapshot<SettingsSaveStatus> = this.store

  /**
   * Follow one queued write without changing its result.
   * @param write - the write's settlement: true accepted, false refused; a rejection counts as refused.
   * @returns the same promise.
   */
  track(write: Promise<boolean>): Promise<boolean> {
    this.begin()
    write.then((accepted) => { this.settle(accepted) }, () => { this.settle(false) })
    return write
  }

  /** Cancel the pending expiry; the tracker keeps its last status. */
  dispose(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private begin(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.pending === 0) this.anyFailed = false
    this.pending += 1
    this.store.set({ state: 'saving' })
  }

  private settle(accepted: boolean): void {
    this.pending -= 1
    if (!accepted) this.anyFailed = true
    if (this.pending > 0) return
    const failed = this.anyFailed
    this.store.set({ state: failed ? 'failed' : 'saved' })
    this.timer = setTimeout(() => { this.store.set({ state: 'idle' }) }, failed ? FAILED_NOTICE_MS : SAVED_NOTICE_MS)
  }
}
