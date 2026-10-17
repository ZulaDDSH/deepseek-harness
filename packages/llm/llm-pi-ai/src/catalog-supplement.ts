/**
 * Models a pinned pi-ai release does not ship yet.
 *
 * pi-ai generates its provider catalogs from [models.dev](https://models.dev)
 * and publishes them inside a versioned package, so a model OpenCode adds
 * between pi-ai releases is absent until the dependency is upgraded. The
 * harness builds offline and reproducibly, so it cannot read models.dev at
 * request time; this table carries the models the pinned catalog is missing,
 * transcribed from the same models.dev source, and {@link catalogModels}
 * merges them only for ids the installed catalog does not already describe.
 * The installed entry always wins, so an upgrade retires an entry by making it
 * a no-op — then delete it.
 *
 * Each entry is the pi-ai `Model` the installed catalog would have carried,
 * including the protocol, endpoint, capacities, modalities, cost, and the
 * provider quirks (thinking format, reasoning-content replay) that a raw
 * models.dev row does not spell out. Only a data gap belongs here: a model the
 * installed catalog describes with a wrong field is a `modelOverrides` edit,
 * not a supplement.
 *
 * @module dsh-llm-pi-ai/catalog-supplement
 */

import type { Api, Model } from '@earendil-works/pi-ai'

/**
 * Supplemented models by pi-ai provider id (also the catalog route key). Every
 * model carries its provider protocol and compatibility fields.
 */
const SUPPLEMENT: Readonly<Record<string, readonly Model<Api>[]>> = {
  deepseek: [
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      api: 'openai-completions',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      reasoning: true,
      thinkingLevelMap: { minimal: null, low: 'low', medium: null, high: 'high', max: 'max' },
      input: ['text'],
      cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 384_000,
      compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens', requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' },
    },
  ],
  opencode: [
    {
      id: 'gpt-5.3-codex-spark',
      name: 'GPT-5.3 Codex Spark',
      api: 'openai-responses',
      provider: 'opencode',
      baseUrl: 'https://opencode.ai/zen/v1',
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: null },
      input: ['text'],
      cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 128_000,
      compat: { sessionAffinityFormat: 'openai-nosession', supportsOpenAIGrammarTools: true },
    },
  ],
}

/**
 * The models a pinned pi-ai catalog is missing for one provider.
 * @param provider - pi-ai provider id, which is also the catalog route key.
 * @returns the supplemented models; empty for a provider with no gap.
 */
export function catalogSupplements(provider: string): readonly Model<Api>[] {
  return SUPPLEMENT[provider] ?? []
}
