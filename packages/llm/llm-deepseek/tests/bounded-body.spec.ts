import { describe, expect, it } from 'vitest'
import { DeepSeekFilesClient } from '../src/files-api.ts'
import { MAX_ERROR_BODY_BYTES, MAX_FILES_RESPONSE_BYTES, readBoundedText } from '../src/bounded-body.ts'

function endless(chunk: Uint8Array, state: { pulls: number; cancelled: boolean }): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls += 1
      controller.enqueue(chunk)
    },
    cancel() {
      state.cancelled = true
    },
  })
}

describe('readBoundedText', () => {
  it('collects a body within the limit unchanged', async () => {
    await expect(readBoundedText(new Response('{"a":1}'), 100)).resolves.toEqual({ text: '{"a":1}', truncated: false })
  })

  it('cancels an endless chunked body at the limit', async () => {
    const state = { pulls: 0, cancelled: false }
    const result = await readBoundedText(new Response(endless(new Uint8Array(1024).fill(97), state)), 4_096)
    expect(result.truncated).toBe(true)
    expect(result.text.length).toBe(4_096)
    expect(state.cancelled).toBe(true)
    expect(state.pulls).toBeLessThan(20)
  })

  it('refuses an oversized declared length without reading', async () => {
    const state = { pulls: 0, cancelled: false }
    const response = new Response(endless(new Uint8Array(8), state), { headers: { 'content-length': '999999' } })
    await expect(readBoundedText(response, 1_000)).resolves.toEqual({ text: '', truncated: true })
    expect(state.cancelled).toBe(true)
  })
})

describe('DeepSeek Files client response bounds', () => {
  const client = (fetchImpl: typeof fetch) => new DeepSeekFilesClient({
    baseURL: 'https://api.deepseek.com', headers: { 'x-api-key': 'k' }, fetch: fetchImpl,
  })

  it('rejects an endless successful JSON body instead of buffering it', async () => {
    const state = { pulls: 0, cancelled: false }
    const fetchImpl = (async () => new Response(endless(new Uint8Array(1024 * 1024).fill(32), state))) as typeof fetch
    await expect(client(fetchImpl).list()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(state.cancelled).toBe(true)
    expect(state.pulls).toBeLessThanOrEqual(MAX_FILES_RESPONSE_BYTES / (1024 * 1024) + 3)
  })

  it('keeps the HTTP status when a failed response body is oversized', async () => {
    const state = { pulls: 0, cancelled: false }
    const fetchImpl = (async () => new Response(
      endless(new Uint8Array(MAX_ERROR_BODY_BYTES).fill(120), state), { status: 502 },
    )) as typeof fetch
    await expect(client(fetchImpl).list()).rejects.toMatchObject({ failure: { status: 502 } })
    expect(state.cancelled).toBe(true)
  })
})
