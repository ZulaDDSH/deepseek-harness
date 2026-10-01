/** Account usage for the same OAuth account used by Codex inference. */
import { z } from 'zod'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type { QuotaSource } from '@deepseek-ai/dsh-api-quota-controller'
import type { QuotaWindow, QuotaWindowId } from '@deepseek-ai/dsh-api-quota-controller/types'
import type { PiAiAuthInjection } from './adapter.ts'

const windowSchema = z.object({
  used_percent: z.number().min(0).max(100),
  limit_window_seconds: z.number().int().positive(),
  reset_at: z.number().int().nonnegative().nullable().optional(),
})
const rateSchema = z.object({
  allowed: z.boolean().optional(),
  limit_reached: z.boolean().optional(),
  primary_window: windowSchema.nullable().optional(),
  secondary_window: windowSchema.nullable().optional(),
})
const usageSchema = z.object({ rate_limit: rateSchema })
const claimsSchema = z.object({ 'https://api.openai.com/auth': z.object({ chatgpt_account_id: z.string().min(1) }) })

/**
 * Create a Codex account source with provider-owned token refresh.
 * @param auth - inference credential store and ambient auth.
 * @param enabled - whether the Codex route is enabled.
 * @returns account quota source.
 */
export function createCodexQuotaSource(auth: PiAiAuthInjection, enabled: () => boolean): QuotaSource {
  const models = builtinModels(auth)
  return {
    id: 'openai-codex', name: 'OpenAI Codex',
    async configured() { return enabled() && (await auth.credentials.read('openai-codex'))?.type === 'oauth' },
    async fetch(fetchImpl) {
      const identity = { providerId: this.id, providerName: this.name }
      try {
        if (!await this.configured()) return { ...identity, configured: false, ok: false, error: 'Not configured' }
        const resolved = await models.getAuth('openai-codex').catch(() => { throw new Error('Codex authentication failed; sign in again') })
        if (!resolved?.auth.apiKey) throw new Error('Codex authentication unavailable')
        const claimPart = resolved.auth.apiKey.split('.')[1]
        if (claimPart === undefined) throw new Error('Codex account token is invalid')
        const claims = claimsSchema.parse(JSON.parse(Buffer.from(claimPart, 'base64url').toString('utf8')))
        const response = await fetchImpl('https://chatgpt.com/backend-api/wham/usage', {
          headers: { Authorization: `Bearer ${resolved.auth.apiKey}`, 'ChatGPT-Account-Id': claims['https://api.openai.com/auth'].chatgpt_account_id, Accept: 'application/json' },
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) throw new Error(`Codex usage API returned HTTP ${response.status}`)
        const { rate_limit: rate } = usageSchema.parse(await response.json())
        const windows: Partial<Record<QuotaWindowId, QuotaWindow>> = {}
        for (const window of [rate.primary_window, rate.secondary_window]) {
          if (window === undefined || window === null) continue
          const id = window.limit_window_seconds === 300 * 60 ? '5h' : window.limit_window_seconds === 7 * 24 * 60 * 60 ? 'weekly' : undefined
          if (id === undefined) throw new Error('Codex reported an unsupported usage window')
          windows[id] = { usedPercent: window.used_percent, resetAt: window.reset_at == null ? null : window.reset_at * 1000,
            ...(rate.allowed === false || rate.limit_reached === true ? { status: 'rate-limited' } : {}) }
        }
        if (Object.keys(windows).length === 0) throw new Error('Codex usage windows unavailable')
        return { ...identity, configured: true, ok: true, windows }
      } catch (error) {
        return { ...identity, configured: true, ok: false, error: error instanceof z.ZodError ? 'Codex usage data could not be parsed' : error instanceof Error ? error.message : 'Codex usage request failed' }
      }
    },
  }
}
