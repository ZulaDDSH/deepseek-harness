import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import {
  PerplexitySearchProvider,
  PERPLEXITY_PROVIDER_ID,
} from '@deepseek-ai/dsh-web-search-perplexity'
import * as perplexityPlugin from '@deepseek-ai/dsh-web-search-perplexity'
import { mapPerplexityResponse } from '../src/provider.ts'

const options = { apiKey: 'pplx-key', baseURL: 'https://api.perplexity.test', model: 'sonar', maxTokens: 1024 }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Perplexity response mapping', () => {
  it('maps the answer and keeps structured search_results and appends extra citations', () => {
    const result = mapPerplexityResponse({
      choices: [{ message: { content: 'the answer' } }],
      search_results: [
        { url: 'https://a.test', title: 'A', snippet: 'snip', date: '2026-02-02' },
        { url: 'https://b.test' },
      ],
      citations: ['https://a.test', 'https://extra.test'],
    })
    expect(result).toEqual({
      content: 'the answer',
      sources: [
        { url: 'https://a.test', title: 'A', snippet: 'snip', publishedAt: '2026-02-02' },
        { url: 'https://b.test' },
        { url: 'https://extra.test' },
      ],
      truncated: false,
    })
  })

  it('falls back to URL-only citations when search_results is absent', () => {
    const result = mapPerplexityResponse({
      choices: [{ message: { content: 'answer' } }],
      citations: ['https://a.test', 'https://b.test'],
    })
    expect(result.sources).toEqual([{ url: 'https://a.test' }, { url: 'https://b.test' }])
  })

  it('omits content when the answer is empty or missing', () => {
    expect(mapPerplexityResponse({ citations: [] }).content).toBeUndefined()
    expect(mapPerplexityResponse({ choices: [{ message: { content: '' } }] }).content).toBeUndefined()
    expect(mapPerplexityResponse({ choices: [{ message: { content: null } }] }).content).toBeUndefined()
  })

  it('omits null/empty optional source fields', () => {
    const result = mapPerplexityResponse({
      search_results: [{ url: 'https://a.test', title: null, snippet: '', date: null }],
    })
    expect(result.sources).toEqual([{ url: 'https://a.test' }])
  })

  it('yields no sources when neither search_results nor citations are present', () => {
    expect(mapPerplexityResponse({ choices: [{ message: { content: 'a' } }] }).sources).toEqual([])
  })
})

describe('PerplexitySearchProvider availability', () => {
  it('is unavailable without a key', () => {
    expect(new PerplexitySearchProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is available with a key', () => {
    expect(new PerplexitySearchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new PerplexitySearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured when maxTokens is not a positive integer', () => {
    expect(new PerplexitySearchProvider({ ...options, maxTokens: 0 }).available()).toBe(false)
    expect(new PerplexitySearchProvider({ ...options, maxTokens: 1.5 }).available()).toBe(false)
  })
})

describe('PerplexitySearchProvider request mapping', () => {
  it('sends a chat-completions request with the query, model and max_tokens', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'a' } }], citations: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new PerplexitySearchProvider(options).search({ query: 'hello' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.perplexity.test/chat/completions')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer pplx-key')
    expect(JSON.parse(init.body as string)).toEqual({ model: 'sonar', max_tokens: 1024, messages: [{ role: 'user', content: 'hello' }] })
  })

  it('sends search_recency_filter when configured, and omits it otherwise', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'a' } }], citations: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new PerplexitySearchProvider({ ...options, searchRecency: 'week' }).search({ query: 'q' })
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ search_recency_filter: 'week' })

    await new PerplexitySearchProvider(options).search({ query: 'q' })
    expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).not.toHaveProperty('search_recency_filter')
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ citations: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new PerplexitySearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('PerplexitySearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'rate limited' } }, { status: 429 })))
    await expect(new PerplexitySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'rate limited' }))
  })

  it('handles a string-form error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad request' }, { status: 400 })))
    await expect(new PerplexitySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'bad request' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ search_results: null }, { status: 200 })))
    await expect(new PerplexitySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream error', { status: 503 })))
    await expect(new PerplexitySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Perplexity API error (HTTP 503)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new PerplexitySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Perplexity API error (HTTP 500)' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new PerplexitySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new PerplexitySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = new Response(new ReadableStream({ pull(streamController) { streamController.error(new DOMException('aborted', 'AbortError')) } }), { status: 200 })
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new PerplexitySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = new Response(new ReadableStream({ pull(streamController) { streamController.error(new DOMException('aborted', 'AbortError')) } }), { status: 500 })
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new PerplexitySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new PerplexitySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('web-search-perplexity plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'a' } }], citations: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: PERPLEXITY_PROVIDER_ID })
    const fiber = await ctx.plugin(perplexityPlugin, { apiKey: 'pplx-key' })
    expect(ctx.web.listProviders().search).toContainEqual(expect.objectContaining({ id: 'perplexity', title: 'Perplexity' }))
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'a', sources: [] })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in perplexityPlugin).toBe(false)
  })

  it('threads maxTokens and searchRecency config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'a' } }], citations: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: PERPLEXITY_PROVIDER_ID })
    const fiber = await ctx.plugin(perplexityPlugin, { apiKey: 'pplx-key', maxTokens: 256, searchRecency: 'month' })
    await ctx.web.search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ max_tokens: 256, search_recency_filter: 'month' })
    await fiber.dispose()
  })

  it('falls back to env key and defaults for base URL and model when config omits them', async () => {
    const prev = process.env.PERPLEXITY_API_KEY
    process.env.PERPLEXITY_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'a' } }], citations: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: PERPLEXITY_PROVIDER_ID })
      const fiber = await ctx.plugin(perplexityPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://api.perplexity.ai/chat/completions')
      expect(JSON.parse(init.body as string)).toMatchObject({ model: 'sonar' })
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.PERPLEXITY_API_KEY
      else process.env.PERPLEXITY_API_KEY = prev
    }
  })

  it('is unavailable when neither config nor env supplies a key', async () => {
    const prev = process.env.PERPLEXITY_API_KEY
    delete process.env.PERPLEXITY_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: PERPLEXITY_PROVIDER_ID })
      await ctx.plugin(perplexityPlugin, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    } finally {
      if (prev !== undefined) process.env.PERPLEXITY_API_KEY = prev
    }
  })
})

describe('PerplexitySearchProvider bounds and cancellation', () => {
  const oversized = (key: string): string => JSON.stringify({ [key]: 'x'.repeat(5 * 1024 * 1024) })

  it('rejects a success body over the byte cap without parsing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(oversized('pad'), { status: 200 })))
    await expect(new PerplexitySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_RESPONSE_TOO_LARGE' }))
  })

  it('keeps the status-line message when an error body is over the byte cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(oversized('message'), { status: 500 })))
    await expect(new PerplexitySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Perplexity API error (HTTP 500)' }))
  })

  it('reports WEB_ABORTED with the caller reason when fetch rejects with a non-DOM abort reason', async () => {
    const reason = new Error('caller stopped')
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(reason); throw reason }))
    const error = await new PerplexitySearchProvider(options).search({ query: 'q' }, controller.signal).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'WEB_ABORTED', cause: reason })
  })

  it('reports WEB_ABORTED when the signal aborts while the success body is read', async () => {
    const reason = new Error('caller stopped')
    const controller = new AbortController()
    const body = new ReadableStream({ pull(streamController) { controller.abort(reason); streamController.error(new Error('stream broke')) } }, { highWaterMark: 0 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))
    const error = await new PerplexitySearchProvider(options).search({ query: 'q' }, controller.signal).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'WEB_ABORTED', cause: reason })
  })

  it('returns citations as sources when search_results is empty or lacks them', () => {
    expect(mapPerplexityResponse({ search_results: [], citations: ['https://a.test', 'https://a.test', 'https://b.test'] }).sources)
      .toEqual([{ url: 'https://a.test' }, { url: 'https://b.test' }])
    expect(mapPerplexityResponse({ search_results: [{ url: 'https://a.test', title: 'A' }, { title: 'no url' } as never], citations: ['https://c.test'] }).sources)
      .toEqual([{ url: 'https://a.test', title: 'A' }, { url: 'https://c.test' }])
  })
})
