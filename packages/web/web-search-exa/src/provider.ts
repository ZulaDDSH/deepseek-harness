/**
 * `ExaSearchProvider`: a `WebSearchProvider` backed by the Exa search API (`POST /search` with
 * highlight contents). It maps the first non-blank highlight to `snippet`, maps
 * `publishedDate` to `publishedAt`, drops entries without a snippet, and omits `content`
 * because Exa returns no generated answer.
 * @module @deepseek-ai/dsh-web-search-exa/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import { readBoundedJson } from '@deepseek-ai/dsh-web/safety'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { ExaError, ExaResult, ExaSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const EXA_PROVIDER_ID = 'exa'

/** Default Exa search endpoint; `/search` is the operation. */
export const EXA_DEFAULT_BASE_URL = 'https://api.exa.ai'

/** Default retrieval mode: let Exa pick between keyword and neural search. */
export const EXA_DEFAULT_SEARCH_TYPE = 'auto'

/** Default number of highlight sentences requested per result. */
export const EXA_DEFAULT_HIGHLIGHTS_PER_RESULT = 1

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface ExaSearchProviderOptions {
  /** Exa API key. Empty/absent makes the provider unavailable. */
  apiKey: string
  /** Endpoint base; `/search` is appended. */
  baseURL: string
  /** Retrieval mode sent as Exa's `type`. */
  searchType: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. */
  numResults?: number
  /** Highlight sentences requested per result (Exa's `highlightsPerUrl`). */
  highlightsPerResult: number
}

export function mapExaResult(result: ExaResult, highlights: number = EXA_DEFAULT_HIGHLIGHTS_PER_RESULT): WebSearchSource {
  const snippet = (result.highlights ?? []).filter(highlight => highlight.trim().length > 0).slice(0, highlights).join(' … ')
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    ...snippet.length > 0 ? { snippet } : {},
    ...result.publishedDate != null && result.publishedDate.length > 0 ? { publishedAt: result.publishedDate } : {},
  }
}

export function mapExaResponse(response: ExaSearchResponse, highlights: number = EXA_DEFAULT_HIGHLIGHTS_PER_RESULT): WebSearchResult {
  return { sources: (response.results ?? []).map(result => mapExaResult(result, highlights)), truncated: false }
}

/** The Exa-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class ExaSearchProvider implements WebSearchProvider {
  readonly id = EXA_PROVIDER_ID
  readonly title = 'Exa'
  readonly description = { en: 'Exa keyword or neural search with source snippets and publication dates; no generated answer.' }

  constructor(private readonly options: ExaSearchProviderOptions) {}

  available(): boolean {
    return this.options.apiKey.length > 0
      && isValidBaseUrl(this.options.baseURL)
      && isPositiveInteger(this.options.highlightsPerResult)
      && (this.options.numResults === undefined || isPositiveInteger(this.options.numResults))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // A per-request bound wins over the configured default; either may be absent.
    const numResults = request.maxResults ?? this.options.numResults
    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          query: request.query,
          type: this.options.searchType,
          contents: { highlights: true },
          ...numResults !== undefined ? { numResults } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isCancelled(signal, error)) throw cancelled(signal, error)
      throw new WebError(`Exa search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Exa API error (HTTP ${status})`
      try {
        const parsed = await readBoundedJson(response, signal) as ExaError
        const detail = parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isCancelled(signal, error)) throw cancelled(signal, error)
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await readBoundedJson(response, signal) as ExaSearchResponse
      return mapExaResponse(payload, this.options.highlightsPerResult)
    } catch (error: unknown) {
      if (isCancelled(signal, error)) throw cancelled(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`Exa returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a request limit that can be sent to Exa (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function isCancelled(signal: AbortSignal | undefined, error: unknown): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError')
}

function cancelled(signal: AbortSignal | undefined, error: unknown): WebError {
  return new WebError('Exa search aborted', 'WEB_ABORTED', { cause: signal?.aborted === true ? signal.reason : error })
}
