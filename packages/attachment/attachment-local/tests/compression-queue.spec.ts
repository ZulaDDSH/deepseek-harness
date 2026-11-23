import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CompressionLimiter } from '../src/compression-limiter.ts'
import LocalAttachmentStore from '../src/index.ts'

const prepare = vi.hoisted(() => ({ fn: vi.fn() }))

vi.mock('../src/store.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/store.ts')>(),
  prepareImageFile: prepare.fn,
}))

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('compression limiter cancellation', () => {
  it('drops a waiting task when its signal aborts and keeps the slot order for the rest', async () => {
    const limiter = new CompressionLimiter(1)
    const gate = deferred()
    const ran: string[] = []
    const first = limiter.run(async () => { await gate.promise; ran.push('first') })
    const controller = new AbortController()
    const dropped = limiter.run(async () => { ran.push('dropped') }, controller.signal)
    const kept = limiter.run(async () => { ran.push('kept') })
    controller.abort(new Error('batch failed'))
    await expect(dropped).rejects.toThrow('batch failed')
    gate.resolve()
    await Promise.all([first, kept])
    expect(ran).toEqual(['first', 'kept'])
  })

  it('refuses a task whose signal is already aborted', async () => {
    const limiter = new CompressionLimiter(1)
    const controller = new AbortController()
    controller.abort(new Error('already'))
    await expect(limiter.run(async () => 'never', controller.signal)).rejects.toThrow('already')
  })
})

describe('image batch admission', () => {
  it('does not prepare queued images after an earlier image in the batch fails', async () => {
    prepare.fn.mockReset()
    const gate = deferred()
    prepare.fn.mockImplementation(async (input: { name: string }) => {
      if (input.name === 'bad') throw new Error('invalid image')
      await gate.promise
      throw new Error('late')
    })
    const store = new LocalAttachmentStore(new Context(), { dshHome: 'unused', imageCompressionConcurrency: 2 })
    const inputs = ['bad', 'slow', 'queued-1', 'queued-2'].map(name => ({
      data: Uint8Array.of(1), mediaType: 'image/png' as const, name,
    }))
    await expect(store.saveImages(inputs)).rejects.toThrow('invalid image')
    gate.resolve()
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    expect(prepare.fn.mock.calls.map(call => (call[0] as { name: string }).name)).toEqual(['bad', 'slow'])
  })
})
