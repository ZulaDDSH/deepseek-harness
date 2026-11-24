import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { JsonRpcLineTransport } from '../src/index.ts'

function stalledWriter(): Writable {
  return new Writable({ highWaterMark: 1, write() {} })
}

describe('JsonRpcLineTransport limits', () => {
  it('fails the transport on an unterminated input line above the frame limit', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = new JsonRpcLineTransport(input, output, { maxFrameChars: 64 })
    const failed = vi.fn()
    const notified = vi.fn()
    transport.onFailure(failed)
    transport.onNotification(notified)
    transport.start()
    const pending = transport.request('wait', {})
    const settled = expect(pending).rejects.toThrow('JSON-RPC frame exceeds 64 characters')

    input.write('x'.repeat(40))
    expect(failed).not.toHaveBeenCalled()
    input.write('x'.repeat(40))
    await settled

    expect(failed).toHaveBeenCalledOnce()
    expect(input.destroyed).toBe(true)
    expect(output.destroyed).toBe(true)
    await expect(transport.request('later', {})).rejects.toThrow('JSON-RPC frame exceeds 64 characters')
    expect(() => { transport.notify('after') }).not.toThrow()
    expect(notified).not.toHaveBeenCalled()
  })

  it('fails on a complete oversized line instead of ignoring it as malformed', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = new JsonRpcLineTransport(input, output, { maxFrameChars: 64 })
    const failed = vi.fn()
    const notified = vi.fn()
    transport.onFailure(failed)
    transport.onNotification(notified)
    transport.start()

    input.write(`${'x'.repeat(100)}\n${JSON.stringify({ jsonrpc: '2.0', method: 'after-oversized' })}\n`)

    expect(failed).toHaveBeenCalledOnce()
    expect(notified).not.toHaveBeenCalled()
    expect(input.destroyed).toBe(true)
  })

  it('accepts frames at the limit and keeps their order', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = new JsonRpcLineTransport(input, output, { maxFrameChars: 200 })
    const seen: string[] = []
    transport.onNotification((method) => { seen.push(method) })
    transport.start()

    for (const method of ['one', 'two', 'three']) {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`)
    }

    expect(seen).toEqual(['one', 'two', 'three'])
  })

  it('fails the transport when a stalled reader lets queued output pass the limit', async () => {
    const input = new PassThrough()
    const output = stalledWriter()
    const transport = new JsonRpcLineTransport(input, output, { maxOutputBytes: 200 })
    const failed = vi.fn()
    transport.onFailure(failed)
    transport.start()
    const pendingFlush = transport.flush()
    const flushed = expect(pendingFlush).rejects.toThrow('JSON-RPC output backlog exceeds 200 bytes')

    for (let index = 0; index < 20; index += 1) transport.notify('event', { index })

    await flushed
    expect(failed).toHaveBeenCalledOnce()
    expect(output.destroyed).toBe(true)
    expect(input.destroyed).toBe(true)
    await expect(transport.flush()).rejects.toThrow('JSON-RPC output backlog exceeds 200 bytes')
    await expect(transport.request('later', {})).rejects.toThrow('JSON-RPC output backlog exceeds 200 bytes')
    expect(() => { transport.notify('after') }).not.toThrow()
  })

  it('releases queued output bytes as the peer drains it', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    output.resume()
    const transport = new JsonRpcLineTransport(input, output, { maxOutputBytes: 200 })
    const failed = vi.fn()
    transport.onFailure(failed)
    transport.start()

    for (let index = 0; index < 20; index += 1) {
      transport.notify('event', { index })
      await transport.flush()
    }

    expect(failed).not.toHaveBeenCalled()
    expect(output.destroyed).toBe(false)
  })
})
