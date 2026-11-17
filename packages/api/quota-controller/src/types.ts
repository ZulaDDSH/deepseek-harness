/** Client-safe provider quota views and usage windows. */

export type QuotaWindowId = '5h' | 'weekly' | 'weekly-opus' | 'weekly-sonnet' | 'monthly' | 'overage' | 'credits'

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

/** Client-safe identity for one quota provider the popover can show. */
export interface QuotaProviderView {
  /** Stable provider identifier used by quota requests. */
  readonly id: string
  /** Human-readable provider name. */
  readonly name: string
}

/** The billing choice of a provider that can bill to a subscription or to API credits. */
export interface QuotaBilling {
  /** The source requests bill to right now. */
  readonly active: 'subscription' | 'api'
  /** The settings write that flips the choice; absent when the provider offers no switch. */
  readonly switch?: QuotaBillingSwitch
  /** The provider's billing console, linked from the popover when it has one. */
  readonly consoleUrl?: string
}

/** Where the billing choice is stored and whether API credits can take effect. */
export interface QuotaBillingSwitch {
  /** Settings namespace the choice writes to. */
  readonly settingsNs: string
  /** Profile path inside that namespace; the choice is the `apiKeyEnv` member under it. */
  readonly settingsPath: readonly string[]
  /** Credential reference that API credits name. */
  readonly apiKeyRef: string
  /** Whether a key is stored under `apiKeyRef`, so switching to API credits works. */
  readonly apiKeyStored: boolean
}

/** An API spending limit the provider refused a request for. */
export interface QuotaApiLimit {
  /** Unix epoch milliseconds when access returns, when the provider named a date. */
  readonly resetAt: number | null
  /** Unix epoch milliseconds the refusal was observed. */
  readonly observedAt: number
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
  /** Unix epoch milliseconds of the newest observation behind the windows, when the provider reports them as observed. */
  readonly asOf?: number
  /** Signed in, but the provider has not reported any usage yet. */
  readonly awaitingUsage?: boolean
  /** The billing choice, for providers whose requests can bill to more than one source. */
  readonly billing?: QuotaBilling
  /** An API spending limit refusal that has not yet lapsed, for providers that bill to API credits. */
  readonly apiLimit?: QuotaApiLimit
  /** Why subscription usage could not be read, when the windows shown are older observations or absent. */
  readonly subscriptionError?: string
}
