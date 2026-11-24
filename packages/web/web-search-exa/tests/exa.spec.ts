import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { ExaSearchProvider, EXA_PROVIDER_ID } from '@deepseek-ai/dsh-web-search-exa'
import * as exaPlugin from '@deepseek-ai/dsh-web-search-exa'
import { mapExaResponse, mapExaResult } from '../src/provider.ts'

const options = { apiKey: 'exa-key', baseURL: 'https://api.exa.test', searchType: 'auto' as const, highlightsPerResult: 1 }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Exa result mapping', () => {
  it('maps a full result entry', () => {
    expect(mapExaResult({
      url: 'https://a.test',
      title: 'A',
      publishedDate: '2026-01-01',
      highlights: ['salient sentence', 'second'],
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'salient sentence', publishedAt: '2026-01-01' })
  })

  it('keeps the URL of a result with no usable highlight, without a snippet', () => {
    expect(mapExaResult({ url: 'https://a.test', highlights: [] })).toEqual({ url: 'https://a.test' })
    expect(mapExaResult({ url: 'https://a.test' })).toEqual({ url: 'https://a.test' })
    expect(mapExaResult({ url: 'https://a.test', highlights: ['  '] })).toEqual({ url: 'https://a.test' })
  })

  it('joins up to the configured number of non-blank highlights into the snippet', () => {
    const result = { url: 'https://a.test', highlights: ['one', ' ', 'two', 'three'] }
    expect(mapExaResult(result, 2).snippet).toBe('one … two')
    expect(mapExaResult(result).snippet).toBe('one')
  })

  it('omits null/empty optional fields rather than emitting them', () => {
    expect(mapExaResult({ url: 'https://a.test', title: null, publishedDate: null, highlights: ['hi'] }))
      .toEqual({ url: 'https://a.test', snippet: 'hi' })
    expect(mapExaResult({ url: 'https://a.test', title: '', publishedDate: '', highlights: ['hi'] }))
      .toEqual({ url: 'https://a.test', snippet: 'hi' })
  })

  it('maps a response to a result with no content and filtered sources', () => {
    const result = mapExaResponse({
      results: [
        { url: 'https://a.test', highlights: ['one'] },
        { url: 'https://b.test' },
        { url: 'https://c.test', title: 'C', highlights: ['three'] },
      ],
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', snippet: 'one' },
        { url: 'https://b.test' },
        { url: 'https://c.test', title: 'C', snippet: 'three' },
      ],
      truncated: false,
    })
    expect(result.content).toBeUndefined()
  })

  it('tolerates a missing results array', () => {
    expect(mapExaResponse({}).sources).toEqual([])
  })

})

describe('ExaSearchProvider availability', () => {
  it('is unavailable without a key', () => {
    expect(new ExaSearchProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is available with a key', () => {
    expect(new ExaSearchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new ExaSearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured when highlightsPerResult is not a positive integer', () => {
    expect(new ExaSearchProvider({ ...options, highlightsPerResult: 0 }).available()).toBe(false)
    expect(new ExaSearchProvider({ ...options, highlightsPerResult: 1.5 }).available()).toBe(false)
  })

  it('is misconfigured when numResults is set but not a positive integer', () => {
    expect(new ExaSearchProvider({ ...options, numResults: -1 }).available()).toBe(false)
  })
})

describe('ExaSearchProvider request mapping', () => {
  it('sends query, type, highlights, numResults and bearer auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [{ url: 'https://a.test', highlights: ['hi'] }] }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new ExaSearchProvider({ ...options, searchType: 'neural', highlightsPerResult: 3 })
    await provider.search({ query: 'hello', maxResults: 5 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.exa.test/search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer exa-key')
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'hello',
      type: 'neural',
      contents: { highlights: true },
      numResults: 5,
    })
  })

  it('falls back to the configured numResults when a request omits maxResults', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new ExaSearchProvider({ ...options, numResults: 7 }).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ numResults: 7 })
  })

  it('lets a request maxResults win over the configured numResults', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new ExaSearchProvider({ ...options, numResults: 7 }).search({ query: 'q', maxResults: 2 })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ numResults: 2 })
  })

  it('omits numResults when neither maxResults nor a configured default is set', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new ExaSearchProvider(options).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).not.toHaveProperty('numResults')
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new ExaSearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('ExaSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad key' }, { status: 401 })))
    await expect(new ExaSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'bad key' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new ExaSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Exa API error (HTTP 502)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new ExaSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Exa API error (HTTP 500)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new ExaSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new ExaSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new ExaSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: {} }, { status: 200 })))
    await expect(new ExaSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = new Response(new ReadableStream({ pull(streamController) { streamController.error(new DOMException('aborted', 'AbortError')) } }), { status: 200 })
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new ExaSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = new Response(new ReadableStream({ pull(streamController) { streamController.error(new DOMException('aborted', 'AbortError')) } }), { status: 500 })
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new ExaSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-exa plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: EXA_PROVIDER_ID })
    const fiber = await ctx.plugin(exaPlugin, { apiKey: 'exa-key' })
    expect(ctx.web.listProviders().search).toContainEqual(expect.objectContaining({ id: 'exa', title: 'Exa' }))
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in exaPlugin).toBe(false)
  })

  it('threads searchType, highlightsPerResult and numResults config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: EXA_PROVIDER_ID })
    const fiber = await ctx.plugin(exaPlugin, { apiKey: 'exa-key', searchType: 'keyword', highlightsPerResult: 2, numResults: 9 })
    await ctx.web.search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ type: 'keyword', contents: { highlights: true }, numResults: 9 })
    await fiber.dispose()
  })

  it('falls back to $EXA_API_KEY and the default base URL when config omits them', async () => {
    const prev = process.env.EXA_API_KEY
    process.env.EXA_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: EXA_PROVIDER_ID })
      const fiber = await ctx.plugin(exaPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).toBe('https://api.exa.ai/search')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.EXA_API_KEY
      else process.env.EXA_API_KEY = prev
    }
  })

  it('is unavailable when neither config nor env supplies a key', async () => {
    const prev = process.env.EXA_API_KEY
    delete process.env.EXA_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: EXA_PROVIDER_ID })
      await ctx.plugin(exaPlugin, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    } finally {
      if (prev !== undefined) process.env.EXA_API_KEY = prev
    }
  })
})

describe('ExaSearchProvider bounds and cancellation', () => {
  const oversized = (key: string): string => JSON.stringify({ [key]: 'x'.repeat(5 * 1024 * 1024) })

  it('rejects a success body over the byte cap without parsing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(oversized('pad'), { status: 200 })))
    await expect(new ExaSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_RESPONSE_TOO_LARGE' }))
  })

  it('keeps the status-line message when an error body is over the byte cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(oversized('error'), { status: 500 })))
    await expect(new ExaSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Exa API error (HTTP 500)' }))
  })

  it('reports WEB_ABORTED with the caller reason when fetch rejects with a non-DOM abort reason', async () => {
    const reason = new Error('caller stopped')
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(reason); throw reason }))
    const error = await new ExaSearchProvider(options).search({ query: 'q' }, controller.signal).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'WEB_ABORTED', cause: reason })
  })

  it('reports WEB_ABORTED when the signal aborts while the success body is read', async () => {
    const reason = new Error('caller stopped')
    const controller = new AbortController()
    const body = new ReadableStream({ pull(streamController) { controller.abort(reason); streamController.error(new Error('stream broke')) } }, { highWaterMark: 0 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))
    const error = await new ExaSearchProvider(options).search({ query: 'q' }, controller.signal).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'WEB_ABORTED', cause: reason })
  })

  it('keeps URL-only sources when no result has a highlight', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [{ url: 'https://a.test', title: 'A' }] })))
    await expect(new ExaSearchProvider(options).search({ query: 'q' }))
      .resolves.toEqual({ sources: [{ url: 'https://a.test', title: 'A' }], truncated: false })
  })
})
