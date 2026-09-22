/** Client-safe provider quota views and usage windows. */

export type QuotaWindowId = '5h' | 'weekly' | 'monthly' | 'credits'

/** One provider-defined quota window normalized for client presentation. */
export interface QuotaWindow {
  /** Percentage consumed when the provider exposes a bounded allowance. */
  readonly usedPercent: number | null
  /** Unix epoch milliseconds when the allowance resets, when known. */
  readonly resetAt: number | null
  /** Provider-formatted value for unbounded balances such as credits. */
  readonly valueLabel?: string
  /**
   * The provider's own status token for this window (OpenCode Go reports
   * `ok`, and a non-`ok` token when the window cannot serve). Passed through
   * verbatim: it is wire data with an open vocabulary, shown as the provider
   * spelled it rather than mapped to invented copy.
   */
  readonly status?: string
}

/** Client-safe identity for one configured quota provider. */
export interface QuotaProviderView {
  /** Stable provider identifier used by quota requests. */
  readonly id: string
  /** Human-readable provider name. */
  readonly name: string
}

/** Normalized result of one provider quota request. */
export interface QuotaResult {
  /** Stable provider identifier. */
  readonly providerId: string
  /** Human-readable provider name. */
  readonly providerName: string
  /** Whether a usable provider credential was available. */
  readonly configured: boolean
  /** Whether the provider request completed successfully. */
  readonly ok: boolean
  /** Provider or transport failure text when the request failed. */
  readonly error?: string
  /** Available quota windows keyed by normalized window id. */
  readonly windows?: Partial<Record<QuotaWindowId, QuotaWindow>>
}
