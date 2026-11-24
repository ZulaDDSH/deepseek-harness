import { AttachmentError } from '@deepseek-ai/dsh-attachment'

export function compressionFailure(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new Error('Image compression task rejected with a non-Error value.', { cause: reason })
}

export interface CompressionQueueLimits {
  readonly tasks: number
  readonly bytes: number
}

export interface CompressionTaskOptions {
  readonly signal?: AbortSignal
  readonly bytes?: number
}

interface Waiter {
  readonly bytes: number
  readonly start: () => void
}

export class CompressionLimiter {
  private active = 0
  private queuedBytes = 0
  private readonly waiting: Waiter[] = []

  constructor(readonly concurrency: number, readonly queue: CompressionQueueLimits) {}

  get queued(): number {
    return this.waiting.length
  }

  admit(sizes: readonly number[]): void {
    const free = Math.max(0, this.concurrency - this.active)
    const wait = sizes.slice(free)
    const bytes = wait.reduce((total, size) => total + size, 0)
    if (this.waiting.length + wait.length > this.queue.tasks || this.queuedBytes + bytes > this.queue.bytes) {
      throw new AttachmentError('Image processing is busy; retry the request later.', 'IMAGE_QUEUE_FULL')
    }
  }

  run<T>(task: () => Promise<T>, options: CompressionTaskOptions = {}): Promise<T> {
    const { signal, bytes = 0 } = options
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(compressionFailure(signal.reason))
        return
      }
      try {
        this.admit([bytes])
      } catch (error: unknown) {
        reject(compressionFailure(error))
        return
      }
      const drop = (): void => {
        const index = this.waiting.indexOf(waiter)
        if (index >= 0) {
          this.waiting.splice(index, 1)
          this.queuedBytes -= bytes
        }
        reject(compressionFailure(signal?.reason))
      }
      const start = (): void => {
        signal?.removeEventListener('abort', drop)
        this.active += 1
        const release = (): void => {
          this.active -= 1
          const next = this.waiting.shift()
          if (next !== undefined) {
            this.queuedBytes -= next.bytes
            next.start()
          }
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
      const waiter: Waiter = { bytes, start }
      if (this.active < this.concurrency) {
        start()
      } else {
        this.waiting.push(waiter)
        this.queuedBytes += bytes
        signal?.addEventListener('abort', drop, { once: true })
      }
    })
  }
}
