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
  anthropic: [
    {
      id: 'claude-opus-5-5',
      name: 'Claude Opus 5.5',
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      },
      cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      compat: {
        supportsMidConvoEffort: true,
        forceAdaptiveThinking: true,
        supportsTemperature: false,
        supportsStrictTools: true,
      },
    },
    {
      id: 'claude-sonnet-5-5',
      name: 'Claude Sonnet 5.5',
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      },
      cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      compat: {
        supportsMidConvoEffort: true,
        forceAdaptiveThinking: true,
        supportsTemperature: false,
        supportsStrictTools: true,
      },
    },
  ],
  openai: [
    {
      id: 'gpt-6.1-sol',
      name: 'GPT-6.1 Sol',
      api: 'openai-responses',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 1_050_000,
      maxTokens: 128_000,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      },
      cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    },
  ],
  'openai-codex': [
    {
      id: 'gpt-6.1-sol',
      name: 'GPT-6.1 Sol',
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 272_000,
      maxTokens: 128_000,
      thinkingLevelMap: {
        off: null,
        minimal: 'low',
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      },
      cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    },
  ],
  'opencode-go': [
    {
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      api: 'openai-completions',
      provider: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      reasoning: true,
      thinkingLevelMap: { minimal: null, low: 'low', medium: null, high: 'high', max: 'max' },
      input: ['text', 'image'],
      cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 384_000,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        maxTokensField: 'max_tokens',
        requiresReasoningContentOnAssistantMessages: true,
        thinkingFormat: 'deepseek',
      },
    },
    {
      id: 'gpt-6-luna',
      name: 'GPT-6 Luna',
      api: 'openai-responses',
      provider: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 1_050_000,
      maxTokens: 128_000,
      thinkingLevelMap: {
        off: 'none',
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      },
      cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      compat: { sessionAffinityFormat: 'openai-nosession' },
    },
    {
      id: 'grok-4.7',
      name: 'Grok 4.7',
      api: 'openai-responses',
      provider: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 500_000,
      maxTokens: 500_000,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: null,
      },
      cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
      compat: { sessionAffinityFormat: 'openai-nosession' },
    },
    {
      id: 'longcat-2.5-preview-free',
      name: 'LongCat 2.5 Preview Free',
      api: 'openai-completions',
      provider: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      reasoning: true,
      thinkingLevelMap: { minimal: null, low: 'low', medium: 'medium', high: 'high' },
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 131_072,
      compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
    },
    {
      id: 'mimo-v2.6-flash',
      name: 'MiMo-V2.6-Flash',
      api: 'openai-completions',
      provider: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      contextWindow: 1_048_576,
      maxTokens: 131_072,
      compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
    },
    {
      id: 'mimo-v2.6-pro',
      name: 'MiMo-V2.6-Pro',
      api: 'openai-completions',
      provider: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
      contextWindow: 1_048_576,
      maxTokens: 131_072,
      compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
    },
    {
      id: 'space-bunny-free',
      name: 'Space Bunny Free',
      api: 'openai-completions',
      provider: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      reasoning: true,
      thinkingLevelMap: { minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_048_576,
      maxTokens: 524_288,
      compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
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
