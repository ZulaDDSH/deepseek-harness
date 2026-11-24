export class Limiter {
  private running = 0
  private readonly waiting: (() => void)[] = []
  private readonly concurrency: number
  private readonly maxWaiting: number

  constructor(concurrency: number, maxWaiting: number) {
    this.concurrency = concurrency
    this.maxWaiting = maxWaiting
  }

  async run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    if (this.running < this.concurrency) this.running++
    else {
      if (this.waiting.length >= this.maxWaiting) throw new Error('forge-session: too many lookups are waiting')
      await this.wait(signal)
    }
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  private wait(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const wake = (): void => {
        signal.removeEventListener('abort', cancel)
        resolve()
      }
      const cancel = (): void => {
        this.waiting.splice(this.waiting.indexOf(wake), 1)
        reject(signal.reason)
      }
      this.waiting.push(wake)
      signal.addEventListener('abort', cancel, { once: true })
    })
  }

  private release(): void {
    const next = this.waiting.shift()
    if (next === undefined) this.running--
    else next()
  }
}
