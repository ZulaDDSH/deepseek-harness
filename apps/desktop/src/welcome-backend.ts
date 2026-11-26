import type { ProductEvent } from '@deepseek-ai/dsh-client-product-analytics/types'
/** Native account, analytics, and locale operations using the shared Web authentication and RPC APIs. */

import { randomUUID } from 'node:crypto'
import { desktopAccountBackend, type DesktopAccountBackend } from './account-backend.ts'

/** Narrow operations available to the native shell. */
export interface DesktopWelcomeBackend {
  /** @returns the current Host policy; every read observes live configuration. */
  analyticsEnabled(): Promise<boolean>
  readonly account: DesktopAccountBackend
  /** @param event - desktop-owned fields. @returns after local Host intake. */
  report(event: ProductEvent): Promise<void>
  /** @returns The saved UI language without account or provider requests. */
  readLocalePreference(): Promise<string | null>
}

const MAX_FAILURE_BODY_BYTES = 512
const MAX_FAILURE_SNIPPET_CHARS = 200

async function failureSnippet(response: Response): Promise<string> {
  try {
    const reader = response.body?.getReader()
    if (reader === undefined) return ''
    const chunks: Uint8Array[] = []
    let size = 0
    while (size < MAX_FAILURE_BODY_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.length
    }
    void reader.cancel().catch(() => undefined)
    const text = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_FAILURE_BODY_BYTES))
    return text.replace(/dsh-desktop-session=[^;\s]*/giu, '[redacted]').replace(/\b[\w-]*cookie[\w-]*\s*[:=][^\r\n]*/giu, '[redacted]')
      .replace(/[A-Za-z0-9_-]{32,}/gu, '[redacted]').replace(/\s+/gu, ' ').trim().slice(0, MAX_FAILURE_SNIPPET_CHARS)
  } catch { return '' }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Connect native RPC and account streams using the Host-issued session cookie.
 * @param hostUrl - URL supplied by the running Desktop Host.
 * @param send - Electron network fetch implementation.
 * @param cookies - Current Host-issued session cookie; reread for each request and reconnect.
 * @returns metadata reads and write-only credential operations over standard RPC.
 */
export async function connectDesktopWelcome(
  hostUrl: string,
  send: (input: string, init?: RequestInit) => Promise<Response>,
  cookies: () => Promise<string>,
): Promise<DesktopWelcomeBackend> {
  const origin = new URL(hostUrl).origin
  const invoke = async (
    request: { namespace: string; method: string; args: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const rpcId = randomUUID()
    const method = `${request.namespace}/${request.method}`
    const cookie = await cookies()
    const response = await send(new URL(`/api/${method}`, origin).href, {
      // credentials omit: with the default, Chromium replaces the explicit Cookie header by jar cookies
      method: 'POST', redirect: 'error', credentials: 'omit', ...(signal === undefined ? {} : { signal }),
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: request.args } }),
    })
    if (!response.ok) {
      const snippet = await failureSnippet(response)
      throw new Error(`desktop welcome: Web request failed: ${method} HTTP ${String(response.status)}${snippet === '' ? '' : ` ${snippet}`}`)
    }
    const envelope: unknown = await response.json()
    if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !record(envelope.result) || envelope.result.ok !== true) {
      throw new Error('desktop welcome: Web RPC failed')
    }
    return envelope.result.value
  }
  const account = desktopAccountBackend(origin, invoke, cookies)
  return {
    account,
    async analyticsEnabled() {
      const enabled = await invoke({ namespace: 'productAnalytics', method: 'enabled', args: {} }, AbortSignal.timeout(1000))
      if (typeof enabled !== 'boolean') throw new Error('desktop analytics: invalid collection policy')
      return enabled
    },
    async report(event) { await invoke({ namespace: 'productAnalytics', method: 'report', args: { event } }, AbortSignal.timeout(1000)) },
    async readLocalePreference() {
      const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} })
      if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('desktop welcome: missing settings namespaces')
      const locale: unknown = settings.namespaces.find((item: unknown) => record(item) && item.ns === 'locale')
      if (!record(locale) || !record(locale.value)
        || (locale.value.preference !== undefined && typeof locale.value.preference !== 'string')) {
        throw new Error('desktop welcome: invalid locale preference')
      }
      return locale.value.preference ?? null
    },
  }
}
