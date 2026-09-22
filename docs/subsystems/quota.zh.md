# 提供方配额

[English](quota.md) | 中文

[api 包组](../../packages/api/README.zh.md)通过[配额控制器](../../packages/api/quota-controller/README.zh.md)向浏览器客户端报告已配置 LLM 提供方的配额与余额。Host 解析每个提供方的凭据，对同一提供方的并发读取只发出一次请求，并只返回客户端安全的用量字段；凭据值从不经过 Remote 边界。该子系统不注册面向模型的工具，也不追加 Session 事件。

## 归属

| 归属方 | 职责 |
|---|---|
| [quota-controller](../../packages/api/quota-controller/README.zh.md) | `ctx.quotaController`：提供方注册表、凭据解析、合并读取、归一化的配额窗口 |

## 读取

`listProviders()` 为每个凭据可解析的已配置提供方报告一个 `QuotaProviderView`：稳定的 `id` 与展示用的 `name`。`fetch(providerId)` 返回一个 `QuotaResult`，携带该提供方的 `configured` 与 `ok` 标志、读取失败时提供方自己的 `error` 文本，以及按 `QuotaWindowId` 索引的可用 `windows`。窗口在提供方给出有界额度时携带 `usedPercent`，在该额度重置时携带 `resetAt`，对积分等无界余额携带提供方格式化的 `valueLabel`，并原样携带提供方自己的 `status` 令牌——它是词表开放的线路数据，按提供方的写法展示，而不会被映射成杜撰的文案。同一提供方的并发读取共用一次请求；凭据无法解析的提供方不出现在列表中。

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
