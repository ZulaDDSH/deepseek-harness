/** Extensible Host-side provider registry for credential-backed quota APIs. */

import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import type { QuotaResult, QuotaWindow } from './types.ts'

/** Host adapter capable of resolving and reading one provider's quota state. */
export interface QuotaProvider {
  /** Stable provider identifier exposed across the Remote boundary. */
  readonly id: string
  /** Human-readable provider name. */
  readonly name: string
  /** Primary environment-style credential reference. */
  readonly credentialRef: CredentialRef
  /** Ordered fallback references accepted for the provider. */
  readonly credentialRefs?: readonly CredentialRef[]
  /** Optional stored credential record owned by another provider plugin. */
  readonly credentialKey?: CredentialKey
  /**
   * Read the provider quota using one resolved credential.
   * @param credential - resolved credential value and source.
   * @param fetchImpl - fetch implementation used for the provider request.
   * @returns normalized provider quota state.
   */
  fetch(credential: ResolvedCredential, fetchImpl?: typeof fetch): Promise<QuotaResult>
}

function money(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function failure(provider: QuotaProvider, error: unknown): QuotaResult {
  return {
    providerId: provider.id,
    providerName: provider.name,
    configured: true,
    ok: false,
    error: error instanceof Error ? error.message : 'Request failed',
  }
}

function parseOpenCodeWindows(payload: unknown): Partial<Record<'5h' | 'weekly' | 'monthly', QuotaWindow>> {
  if (payload === null || typeof payload !== 'object' || !('usage' in payload)) return {}
  const usage = payload.usage
  if (usage === null || typeof usage !== 'object') return {}
  const usageRecord = usage as Record<string, unknown>
  const result: Partial<Record<'5h' | 'weekly' | 'monthly', QuotaWindow>> = {}
  for (const [id, source] of [['5h', 'rolling'], ['weekly', 'weekly'], ['monthly', 'monthly']] as const) {
    const entry = usageRecord[source]
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const percent = record.percent
    const reset = record.resetsAt
    const resetAt = typeof reset === 'string' ? Date.parse(reset) : Number.NaN
    const rawStatus = record.status
    const status = typeof rawStatus === 'string' && rawStatus.trim() !== '' ? rawStatus : undefined
    const hasPercent = typeof percent === 'number' && Number.isFinite(percent)
    const hasReset = Number.isFinite(resetAt)
    // A window carrying only a status still says something (a limit that cannot
    // serve, for one), so it is kept even without a percent or reset instant.
    if (!hasPercent && !hasReset && status === undefined) continue
    result[id] = {
      usedPercent: hasPercent ? Math.min(100, Math.max(0, percent)) : null,
      resetAt: hasReset ? resetAt : null,
      ...status === undefined ? {} : { status },
    }
  }
  return result
}

function createDeepSeek(): QuotaProvider {
  return {
    id: 'deepseek',
    name: 'DeepSeek',
    credentialRef: 'DEEPSEEK_API_KEY' as CredentialRef,
    credentialKey: credentialKey('llm-pi-ai', 'deepseek'),
    async fetch(credential, fetchImpl = fetch) {
      try {
        const response = await fetchImpl('https://api.deepseek.com/user/balance', {
          headers: { Authorization: `Bearer ${credential.value}`, 'Accept-Encoding': 'identity' },
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'DeepSeek authentication failed' : `DeepSeek API returned HTTP ${response.status}`)
        const payload = await response.json() as { balance_infos?: Array<{ currency?: string; total_balance?: unknown }> }
        const balance = payload.balance_infos?.find(item => item.currency === 'USD')
          ?? payload.balance_infos?.find(item => item.currency === 'CNY')
        const value = money(balance?.total_balance)
        if (value === null) throw new Error('DeepSeek quota data could not be parsed')
        const symbol = balance?.currency === 'CNY' ? '¥' : '$'
        return {
          providerId: 'deepseek', providerName: 'DeepSeek', configured: true, ok: true,
          windows: { credits: { usedPercent: null, resetAt: null, valueLabel: `${symbol}${value.toFixed(2)}` } },
        }
      } catch (error) {
        return failure(this, error)
      }
    },
  }
}

function createOpenCodeGo(): QuotaProvider {
  return {
    id: 'opencode-go',
    name: 'OpenCode Go',
    credentialRef: 'OPENCODE_API_KEY' as CredentialRef,
    credentialRefs: ['OPENCODE_API_KEY' as CredentialRef, 'OPENCODE_GO_API_KEY' as CredentialRef],
    credentialKey: credentialKey('llm-pi-ai', 'opencode-go'),
    async fetch(credential, fetchImpl = fetch) {
      try {
        const response = await fetchImpl('https://opencode.ai/zen/go/v1/usage', {
          headers: { Accept: 'application/json', Authorization: `Bearer ${credential.value}`, 'x-opencode-session': 'dsh-quota' },
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'OpenCode Go authentication failed' : `OpenCode Go API returned HTTP ${response.status}`)
        const windows = parseOpenCodeWindows(await response.json())
        if (Object.keys(windows).length === 0) throw new Error('OpenCode Go quota data could not be parsed')
        return { providerId: 'opencode-go', providerName: 'OpenCode Go', configured: true, ok: true, windows }
      } catch (error) {
        return failure(this, error)
      }
    },
  }
}

/**
 * Create the built-in registry, optionally extending it with deployment providers.
 * @param extra - deployment-specific providers appended to the built-ins.
 * @returns providers keyed by stable provider id.
 */
export function createQuotaProviderRegistry(extra: readonly QuotaProvider[] = []): ReadonlyMap<string, QuotaProvider> {
  const providers = [createDeepSeek(), createOpenCodeGo(), ...extra]
  return new Map(providers.map(provider => [provider.id, provider]))
}
