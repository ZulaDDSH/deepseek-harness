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
    const limiter = new CompressionLimiter(1, { tasks: 8, bytes: 1024 })
    const gate = deferred()
    const ran: string[] = []
    const first = limiter.run(async () => { await gate.promise; ran.push('first') })
    const controller = new AbortController()
    const dropped = limiter.run(async () => { ran.push('dropped') }, { signal: controller.signal })
    const kept = limiter.run(async () => { ran.push('kept') })
    controller.abort(new Error('batch failed'))
    await expect(dropped).rejects.toThrow('batch failed')
    gate.resolve()
    await Promise.all([first, kept])
    expect(ran).toEqual(['first', 'kept'])
  })

  it('refuses a task whose signal is already aborted', async () => {
    const limiter = new CompressionLimiter(1, { tasks: 8, bytes: 1024 })
    const controller = new AbortController()
    controller.abort(new Error('already'))
    await expect(limiter.run(async () => 'never', { signal: controller.signal })).rejects.toThrow('already')
  })

  it('refuses a task beyond the waiting task count and resumes once the slot frees', async () => {
    const limiter = new CompressionLimiter(1, { tasks: 2, bytes: 1024 })
    const gate = deferred()
    const first = limiter.run(async () => { await gate.promise; return 'first' }, { bytes: 10 })
    const second = limiter.run(async () => 'second', { bytes: 10 })
    const third = limiter.run(async () => 'third', { bytes: 10 })
    expect(limiter.queued).toBe(2)
    await expect(limiter.run(async () => 'over', { bytes: 1 })).rejects.toMatchObject({ code: 'IMAGE_QUEUE_FULL' })
    expect(limiter.queued).toBe(2)
    gate.resolve()
    await expect(Promise.all([first, second, third])).resolves.toEqual(['first', 'second', 'third'])
    expect(limiter.queued).toBe(0)
    await expect(limiter.run(async () => 'later', { bytes: 1_000_000 })).resolves.toBe('later')
  })

  it('refuses a task whose waiting bytes would exceed the queue byte budget', async () => {
    const limiter = new CompressionLimiter(1, { tasks: 8, bytes: 100 })
    const gate = deferred()
    const first = limiter.run(async () => { await gate.promise }, { bytes: 1 })
    const held = limiter.run(async () => 'held', { bytes: 60 })
    await expect(limiter.run(async () => 'too-big', { bytes: 50 })).rejects.toMatchObject({ code: 'IMAGE_QUEUE_FULL' })
    const fits = limiter.run(async () => 'fits', { bytes: 40 })
    expect(limiter.queued).toBe(2)
    gate.resolve()
    await expect(Promise.all([first, held, fits])).resolves.toEqual([undefined, 'held', 'fits'])
  })

  it('admits a group of tasks whole or not at all', async () => {
    const limiter = new CompressionLimiter(1, { tasks: 3, bytes: 1024 })
    const gate = deferred()
    const first = limiter.run(async () => { await gate.promise })
    expect(() => limiter.admit([1, 1, 1])).not.toThrow()
    expect(() => limiter.admit([1, 1, 1, 1])).toThrow(expect.objectContaining({ code: 'IMAGE_QUEUE_FULL' }))
    expect(limiter.queued).toBe(0)
    gate.resolve()
    await first
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

  it('refuses a batch that would overflow the waiting line without queuing any of its images', async () => {
    prepare.fn.mockReset()
    const gate = deferred()
    prepare.fn.mockImplementation(async () => {
      await gate.promise
      throw new Error('late')
    })
    const store = new LocalAttachmentStore(new Context(), {
      dshHome: 'unused', imageCompressionConcurrency: 1, maxImagesPerMessage: 2,
    })
    const batch = (prefix: string) => [`${prefix}-1`, `${prefix}-2`].map(name => ({
      data: Uint8Array.of(1), mediaType: 'image/png' as const, name,
    }))
    const admitted = [store.saveImages(batch('a')), store.saveImages(batch('b'))]
    await expect(store.saveImages(batch('c'))).rejects.toMatchObject({ code: 'IMAGE_QUEUE_FULL' })
    await expect(store.saveImages(batch('d'))).rejects.toMatchObject({ code: 'IMAGE_QUEUE_FULL' })
    gate.resolve()
    await Promise.allSettled(admitted)
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    const names = prepare.fn.mock.calls.map(call => (call[0] as { name: string }).name)
    expect(names.filter(name => name.startsWith('c-') || name.startsWith('d-'))).toEqual([])
  })

  it('passes the batch signal into each member so a late member of a failed batch never starts', async () => {
    prepare.fn.mockReset()
    prepare.fn.mockImplementation(async (input: { name: string }, _limits: unknown, _policy: unknown) => {
      if (input.name === 'bad') throw new Error('invalid image')
      return { data: Uint8Array.of(1), ref: { attachmentId: `sha256:${'0'.repeat(64)}` } }
    })
    const store = new LocalAttachmentStore(new Context(), { dshHome: 'unused', imageCompressionConcurrency: 1 })
    const inputs = ['bad', 'late'].map(name => ({ data: Uint8Array.of(1), mediaType: 'image/png' as const, name }))
    await expect(store.saveImages(inputs)).rejects.toThrow('invalid image')
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    expect(prepare.fn.mock.calls.map(call => (call[0] as { name: string }).name)).toEqual(['bad'])
  })
})
