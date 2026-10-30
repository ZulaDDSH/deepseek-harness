/** Claude subscription windows observed on the harness's own Anthropic responses and Claude Agent SDK runs. */
import { z } from 'zod'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type { QuotaSource } from '@deepseek-ai/dsh-api-quota-controller'
import type { QuotaApiLimit, QuotaBilling, QuotaWindow, QuotaWindowId } from '@deepseek-ai/dsh-api-quota-controller/types'
import type { LlmRateLimitObservation } from '@deepseek-ai/dsh-llm'
import type { PiAiAuthInjection } from './adapter.ts'
import { catalogProvider } from './catalog.ts'

/** Route id of the Anthropic (Claude) provider. */
export const CLAUDE_ROUTE = 'anthropic'
const CLAUDE_NAME = 'Anthropic (Claude)'
const API_KEY_REF = 'ANTHROPIC_API_KEY'
const CLAUDE_CONSOLE_URL = 'https://platform.claude.com/settings/billing'
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const NO_WINDOWS = 'Claude usage windows unavailable'
const USAGE_TTL_MS = 60_000
const UNDATED_LIMIT_HOLD_MS = 24 * 60 * 60 * 1000
const AMBIENT_REFS: ReadonlyArray<readonly [ref: string, route: QuotaBilling['active']]> = [
  ['ANTHROPIC_AUTH_TOKEN', 'api'],
  ['ANTHROPIC_OAUTH_TOKEN', 'subscription'],
  ['ANTHROPIC_API_KEY', 'api'],
]
const usageWindowSchema = z.object({ utilization: z.number().nullish(), resets_at: z.string().nullish() })
const extraUsageSchema = z.object({ is_enabled: z.boolean().nullish(), utilization: z.number().nullish() })
const usageSchema = z.object({ extra_usage: extraUsageSchema.nullish() }).catchall(z.unknown())
const WINDOW_IDS = new Map<string, QuotaWindowId>([
  ['five_hour', '5h'],
  ['seven_day', 'weekly'],
  ['seven_day_opus', 'weekly-opus'],
  ['seven_day_sonnet', 'weekly-sonnet'],
  ['overage', 'overage'],
])
const HEADER_WINDOWS: ReadonlyArray<readonly [window: string, header: string]> = [['five_hour', '5h'], ['seven_day', '7d']]

/** Recorded Claude windows: the latest observation per window, and the newest observation time. */
export interface ClaudeUsage {
  /** Record one observation; the latest value for a window replaces the earlier one. */
  observe(observation: LlmRateLimitObservation): void
  /** The windows observed so far whose reset has not passed, keyed by quota window id, with the newest observation time. */
  snapshot(now?: number): {
    readonly windows: Partial<Record<QuotaWindowId, QuotaWindow>>
    readonly asOf?: number
    readonly apiLimit?: QuotaApiLimit
  }
  /** Record that the provider refused a request because the API spending limit was reached. */
  observeApiLimit(limit: QuotaApiLimit): void
}

/** Inputs the Claude quota source reads from the plugin's credential store and profile. */
export interface ClaudeQuotaOptions {
  readonly usage: ClaudeUsage
  readonly auth: PiAiAuthInjection
  /** The `apiKeyEnv` the Anthropic route's profile names, when it names one. */
  readonly apiKeyEnv: () => string | undefined
  /** Whether a credential resolves under the reference. */
  readonly keyStored: (ref: string) => Promise<boolean>
  /** Settings namespace the billing choice is written to. */
  readonly settingsNs: string
  /** Route of the account this source reports; defaults to the Anthropic route. */
  readonly route?: string
  /** Name shown for the account; defaults to the Anthropic name. */
  readonly name?: string
}

function headerNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function headerInstant(value: string | undefined, observedAt: number): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const numeric = headerNumber(value)
  if (numeric !== undefined) return numeric < 1e9 ? observedAt + numeric * 1000 : numeric < 1e12 ? numeric * 1000 : numeric
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Window observations carried by one response's unified-limit headers.
 * @param route - the route the response came from.
 * @param headers - the response headers; names match in any case.
 * @param observedAt - Unix epoch milliseconds the response was received.
 * @returns one observation per window with a utilization or reset header.
 */
export function claudeObservationsFromHeaders(
  route: string,
  headers: Readonly<Record<string, string>>,
  observedAt: number,
): LlmRateLimitObservation[] {
  const lower = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]))
  return HEADER_WINDOWS.flatMap(([window, header]) => {
    const prefix = `anthropic-ratelimit-unified-${header}`
    const utilization = headerNumber(lower.get(`${prefix}-utilization`))
    const resetAt = headerInstant(lower.get(`${prefix}-reset`), observedAt)
    if (utilization === undefined && resetAt === undefined) return []
    return [{
      route,
      window,
      observedAt,
      ...utilization === undefined ? {} : { utilization },
      ...resetAt === undefined ? {} : { resetAt },
    }]
  })
}

/**
 * Store of the latest Claude window per window type.
 * @returns the store that records observations and reports windows.
 */
export function createClaudeUsage(route: string = CLAUDE_ROUTE): ClaudeUsage {
  const observed = new Map<string, LlmRateLimitObservation>()
  let limit: QuotaApiLimit | undefined
  return {
    observeApiLimit(next) { limit = next },
    observe(observation) {
      if (observation.route !== route || !WINDOW_IDS.has(observation.window)) return
      observed.set(observation.window, observation)
    },
    snapshot(now = Date.now()) {
      const windows: Partial<Record<QuotaWindowId, QuotaWindow>> = {}
      let asOf: number | undefined
      for (const observation of observed.values()) {
        const id = WINDOW_IDS.get(observation.window)
        if (id === undefined || (observation.resetAt !== undefined && observation.resetAt <= now)) continue
        const percent = observation.utilization === undefined || !Number.isFinite(observation.utilization)
          ? null
          : Math.min(100, Math.max(0, observation.utilization > 1 ? observation.utilization : observation.utilization * 100))
        windows[id] = {
          usedPercent: percent,
          resetAt: observation.resetAt ?? null,
          ...observation.status === 'rejected' ? { status: 'rejected' } : {},
        }
        asOf = Math.max(asOf ?? observation.observedAt, observation.observedAt)
      }
      const lapsesAt = limit === undefined ? undefined : limit.resetAt ?? limit.observedAt + UNDATED_LIMIT_HOLD_MS
      const apiLimit = limit !== undefined && lapsesAt !== undefined && lapsesAt > now ? limit : undefined
      return { windows, ...asOf === undefined ? {} : { asOf }, ...apiLimit === undefined ? {} : { apiLimit } }
    },
  }
}

function usageWindowsFrom(body: unknown): Partial<Record<QuotaWindowId, QuotaWindow>> {
  const parsed = usageSchema.parse(body)
  const entries: Array<readonly [QuotaWindowId, number, number | null]> = []
  for (const [name, id] of WINDOW_IDS) {
    const entry = usageWindowSchema.safeParse(parsed[name])
    if (!entry.success || entry.data.utilization == null || !Number.isFinite(entry.data.utilization)) continue
    const resetAt = entry.data.resets_at == null ? Number.NaN : Date.parse(entry.data.resets_at)
    entries.push([id, entry.data.utilization, Number.isFinite(resetAt) ? resetAt : null])
  }
  const extra = parsed.extra_usage
  if (extra?.is_enabled === true && extra.utilization != null && Number.isFinite(extra.utilization)) {
    entries.push(['overage', extra.utilization, null])
  }
  if (entries.length === 0) throw new Error(NO_WINDOWS)
  const fractions = entries.every(([, value]) => value <= 1) && entries.some(([, value]) => value > 0 && value < 1)
  const windows: Partial<Record<QuotaWindowId, QuotaWindow>> = {}
  for (const [id, value, resetAt] of entries) {
    windows[id] = { usedPercent: Math.min(100, Math.max(0, fractions ? value * 100 : value)), resetAt }
  }
  return windows
}

type Windows = Partial<Record<QuotaWindowId, QuotaWindow>>

async function readSubscriptionWindows(auth: PiAiAuthInjection, route: string, fetchImpl: typeof fetch): Promise<Windows> {
  const models = builtinModels(auth)
  const base = catalogProvider(CLAUDE_ROUTE)
  if (route !== CLAUDE_ROUTE && base !== undefined) models.setProvider({ ...base, id: route })
  const resolved = await models.getAuth(route).catch(() => { throw new Error('Claude authentication failed; sign in again') })
  if (!resolved?.auth.apiKey) throw new Error('Claude authentication unavailable')
  const response = await fetchImpl(USAGE_URL, {
    headers: { Authorization: `Bearer ${resolved.auth.apiKey}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => { throw new Error('Claude usage request failed') })
  if (!response.ok) throw new Error(`Claude usage API returned HTTP ${response.status}`)
  try {
    return usageWindowsFrom(await response.json())
  } catch (error) {
    throw new Error(error instanceof Error && error.message === NO_WINDOWS ? NO_WINDOWS : 'Claude usage data could not be parsed')
  }
}

/**
 * Anthropic quota source: the subscription windows read from the sign-in's own usage endpoint (falling back to windows
 * observed on responses), the API spending limit a request hit, and the subscription and API-credits billing choice.
 * @param options - the usage store, auth, billing reads, and the settings namespace.
 * @returns the quota source registered for the Anthropic route.
 */
export function createClaudeQuotaSource(options: ClaudeQuotaOptions): QuotaSource {
  const route = options.route ?? CLAUDE_ROUTE
  const identity = { providerId: route, providerName: options.name ?? CLAUDE_NAME }
  let live: { readonly at: number; readonly windows: Partial<Record<QuotaWindowId, QuotaWindow>> } | undefined
  const ambientRoute = async (): Promise<QuotaBilling['active'] | undefined> => {
    for (const [ref, route] of AMBIENT_REFS) {
      if (await options.auth.authContext.env(ref)) return route
    }
    return undefined
  }
  const state = async () => {
    const record = await options.auth.credentials.read(route)
    const apiKeyEnv = options.apiKeyEnv()
    const ambient = record === undefined && apiKeyEnv === undefined ? await ambientRoute() : undefined
    const { windows, asOf, apiLimit } = options.usage.snapshot()
    const observed = Object.keys(windows).length > 0
    const subscription = record?.type === 'oauth' || ambient === 'subscription' || (observed && record?.type !== 'api_key')
    const apiKeyRef = apiKeyEnv ?? API_KEY_REF
    const apiKeyStored = await options.keyStored(apiKeyRef)
    const active: QuotaBilling['active'] = apiKeyEnv !== undefined || record?.type === 'api_key' || ambient === 'api' ? 'api' : 'subscription'
    const configured = subscription || ambient !== undefined || record?.type === 'api_key' || (apiKeyEnv !== undefined && apiKeyStored)
    return { subscription, signedIn: record?.type === 'oauth', apiKeyRef, apiKeyStored, active, configured, windows, asOf, apiLimit }
  }
  return {
    id: route,
    name: identity.providerName,
    async configured() { return (await state()).configured },
    async fetch(fetchImpl) {
      try {
        const current = await state()
        if (!current.configured) return { ...identity, configured: false, ok: false, error: 'Not configured' }
        let subscriptionError: string | undefined
        if (current.signedIn) {
          const now = Date.now()
          try {
            if (live === undefined || now - live.at >= USAGE_TTL_MS) {
              live = { at: now, windows: await readSubscriptionWindows(options.auth, route, fetchImpl) }
            }
          } catch (error) {
            live = undefined
            subscriptionError = error instanceof Error ? error.message : 'Claude usage request failed'
          }
        }
        const windows = { ...current.windows, ...live?.windows }
        const asOf = live?.at ?? current.asOf
        return {
          ...identity,
          configured: true,
          ok: true,
          windows,
          ...asOf === undefined ? {} : { asOf },
          ...current.active === 'subscription' && Object.keys(windows).length === 0 && subscriptionError === undefined ? { awaitingUsage: true } : {},
          ...subscriptionError === undefined ? {} : { subscriptionError },
          ...current.apiLimit === undefined ? {} : { apiLimit: current.apiLimit },
          billing: {
            active: current.active,
            consoleUrl: CLAUDE_CONSOLE_URL,
            ...current.subscription ? {
              switch: {
                settingsNs: options.settingsNs,
                settingsPath: ['providers', route],
                apiKeyRef: current.apiKeyRef,
                apiKeyStored: current.apiKeyStored,
              },
            } : {},
          },
        }
      } catch (error) {
        return { ...identity, configured: true, ok: false, error: error instanceof Error ? error.message : 'Claude usage request failed' }
      }
    },
  }
}
