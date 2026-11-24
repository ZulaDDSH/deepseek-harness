import { vi } from 'vitest'

export class FakeSocket {
  destroyed = false
  private readonly closers: Array<() => void> = []
  readonly destroy = vi.fn(() => { this.close() })

  once(_event: 'close', listener: () => void): void {
    this.closers.push(listener)
  }

  close(): void {
    this.destroyed = true
    for (const listener of this.closers.splice(0)) listener()
  }
}
