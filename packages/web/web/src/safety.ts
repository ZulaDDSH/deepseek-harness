import type { WebSearchResult, WebSearchSource } from './types.ts'
import { WebError } from './types.ts'

export const WEB_RESPONSE_MAX_BYTES = 4 * 1024 * 1024

export const WEB_SEARCH_FIELD_MAX_CHARS = {
  content: 32_000,
  title: 500,
  snippet: 2_000,
  summary: 4_000,
  publishedAt: 100,
} as const

export const WEB_SEARCH_URL_MAX_CHARS = 2_048

const ELLIPSIS = '…'

export async function readBoundedJson(
  response: Response, signal?: AbortSignal, maxBytes: number = WEB_RESPONSE_MAX_BYTES,
): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  const tooLarge = (): WebError => new WebError(`response body exceeds the ${maxBytes} byte limit`, 'WEB_RESPONSE_TOO_LARGE')
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw tooLarge()
  }
  const chunks: Uint8Array[] = []
  let total = 0
  if (response.body !== null) {
    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
    const onAbort = (): void => { void reader.cancel(signal?.reason).catch(() => undefined) }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      for (;;) {
        signal?.throwIfAborted()
        const { done, value } = await reader.read()
        signal?.throwIfAborted()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) throw tooLarge()
        chunks.push(value)
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      await reader.cancel().catch(() => undefined)
    }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

function bound(value: string, max: number): string {
  if (value.length <= max) return value
  let end = max - ELLIPSIS.length
  const last = value.charCodeAt(end - 1)
  if (last >= 0xD800 && last <= 0xDBFF) end -= 1
  return `${value.slice(0, end)}${ELLIPSIS}`
}

function boundField(source: WebSearchSource, key: Exclude<keyof typeof WEB_SEARCH_FIELD_MAX_CHARS, 'content'>): Partial<WebSearchSource> {
  const value = source[key]
  return value === undefined ? {} : { [key]: bound(value, WEB_SEARCH_FIELD_MAX_CHARS[key]) }
}

export function boundSearchResult(result: WebSearchResult): WebSearchResult {
  const kept = result.sources.filter(source => source.url.length <= WEB_SEARCH_URL_MAX_CHARS)
  return {
    ...result.content === undefined ? {} : { content: bound(result.content, WEB_SEARCH_FIELD_MAX_CHARS.content) },
    sources: kept.map(source => ({
      url: source.url,
      ...boundField(source, 'title'),
      ...boundField(source, 'snippet'),
      ...boundField(source, 'summary'),
      ...boundField(source, 'publishedAt'),
    })),
    truncated: result.truncated || kept.length !== result.sources.length,
  }
}

export function redactEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return '[unparseable endpoint]'
  }
}
