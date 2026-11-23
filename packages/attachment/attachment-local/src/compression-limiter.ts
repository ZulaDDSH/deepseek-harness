/** Instance-owned concurrency bound for native image transformations. */

/**
 * Preserve Error rejections and normalize non-Error native binding values.
 * @param reason - rejection reason returned by a compression task.
 * @returns an Error suitable for promise rejection.
 */
export function compressionFailure(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new Error('Image compression task rejected with a non-Error value.', { cause: reason })
}

/** FIFO limiter for asynchronous compression work. */
export class CompressionLimiter {
  private active = 0
  private readonly waiting: Array<() => void> = []

  /**
   * @param concurrency - positive maximum number of active tasks.
   */
  constructor(readonly concurrency: number) {}

  /**
   * Run one task after an instance slot becomes available.
   * @param task - compression operation occupying one slot until settlement.
   * @returns the task result.
   */
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(compressionFailure(signal.reason))
        return
      }
      const drop = (): void => {
        const index = this.waiting.indexOf(start)
        if (index >= 0) this.waiting.splice(index, 1)
        reject(compressionFailure(signal?.reason))
      }
      const start = (): void => {
        signal?.removeEventListener('abort', drop)
        this.active += 1
        const release = (): void => {
          this.active -= 1
          this.waiting.shift()?.()
        }
        void Promise.resolve().then(task).then(
          (value) => {
            release()
            resolve(value)
          },
          (error: unknown) => {
            release()
            reject(compressionFailure(error))
          },
        )
      }
      if (this.active < this.concurrency) {
        start()
      } else {
        this.waiting.push(start)
        signal?.addEventListener('abort', drop, { once: true })
      }
    })
  }
}
