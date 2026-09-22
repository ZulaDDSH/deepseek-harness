# Provider Quota

English | [中文](quota.zh.md)

The [api package group](../../packages/api/README.md) reports the configured LLM providers' quota and balance to browser clients through the [quota controller](../../packages/api/quota-controller/README.md). The Host resolves each provider's credential, reads a provider once per concurrent caller, and returns only client-safe usage fields; no credential value crosses the Remote wire. The subsystem registers no model-facing tool and appends no Session event.

## Ownership

| Owner | Responsibility |
|---|---|
| [quota-controller](../../packages/api/quota-controller/README.md) | `ctx.quotaController`: provider registry, credential resolution, coalesced reads, normalized quota windows |

## Reads

`listProviders()` reports one `QuotaProviderView` per configured provider whose credential resolves: a stable `id` and a display `name`. `fetch(providerId)` returns one `QuotaResult` carrying the provider's `configured` and `ok` flags, the provider's own `error` text when the read failed, and the available `windows` keyed by `QuotaWindowId`. A window carries `usedPercent` when the provider exposes a bounded allowance, `resetAt` when that allowance resets, a provider-formatted `valueLabel` for unbounded balances such as credits, and the provider's own `status` token verbatim — wire data with an open vocabulary, shown as the provider spelled it rather than mapped to invented copy. Concurrent reads of one provider share a single request; a provider whose credential does not resolve is absent from the listing.

```ts type-equiv
/** Client-safe provider quota views and usage windows. */
type QuotaWindowId = '5h' | 'weekly' | 'monthly' | 'credits'
```

```ts type-equiv
/** One provider-defined quota window normalized for client presentation. */
interface QuotaWindow {
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
```

```ts type-equiv
/** Client-safe identity for one configured quota provider. */
interface QuotaProviderView {
  /** Stable provider identifier used by quota requests. */
  readonly id: string
  /** Human-readable provider name. */
  readonly name: string
}
```

```ts type-equiv
/** Normalized result of one provider quota request. */
interface QuotaResult {
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
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<!-- END GENERATED cordis-surface -->
