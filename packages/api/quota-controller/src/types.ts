/** Client-safe provider quota views and usage windows. */

export type QuotaWindowId = '5h' | 'weekly' | 'monthly' | 'credits'

export interface QuotaWindow {
  readonly usedPercent: number | null
  readonly resetAt: number | null
  readonly valueLabel?: string
  /**
   * The provider's own status token for this window (OpenCode Go reports
   * `ok`, and a non-`ok` token when the window cannot serve). Passed through
   * verbatim: it is wire data with an open vocabulary, shown as the provider
   * spelled it rather than mapped to invented copy.
   */
  readonly status?: string
}

export interface QuotaProviderView {
  readonly id: string
  readonly name: string
}

export interface QuotaResult {
  readonly providerId: string
  readonly providerName: string
  readonly configured: boolean
  readonly ok: boolean
  readonly error?: string
  readonly windows?: Partial<Record<QuotaWindowId, QuotaWindow>>
}
