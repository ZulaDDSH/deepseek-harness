/**
 * Corrections to catalog entries, the OpenCode endpoint move, and retired OpenCode ids.
 *
 * @module dsh-llm-pi-ai/catalog-corrections
 */

import type { Api, Model } from '@earendil-works/pi-ai'

/** Snapshot date of the OpenCode docs, `/models` listings and models.dev rows used here. */
export const OPENCODE_SNAPSHOT = '2026-10-14'

type Correction = Partial<Pick<Model<Api>, 'contextWindow'>> & { cost?: Partial<Model<Api>['cost']> }

const CORRECTIONS: Readonly<Record<string, Readonly<Record<string, Correction>>>> = {
  openai: {
    'gpt-6.1-sol': { contextWindow: 1_050_000 },
  },
  opencode: {
    'gpt-5.6-terra': { cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, tiers: [{ inputTokensAbove: 272_000, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }] } },
    'deepseek-v4-pro': { cost: { output: 3.48 } },
    'kimi-k2.5': { cost: { cacheRead: 0.1 } },
  },
}

const RETIRED: Readonly<Record<string, readonly string[]>> = {
  opencode: ['claude-sonnet-4', 'deepseek-v4-flash-vision-exp'],
}

const ZEN_BASE = /^https:\/\/opencode\.ai\/zen(?=\/|$)/
const INFERENCE_BASE = 'https://opencode.ai/inference'

/**
 * A catalog model with its OpenCode endpoint moved to `/inference` and its route's correction applied.
 * @param provider - provider route key.
 * @param model - an installed catalog entry or a supplemented one.
 * @returns the corrected entry; the entry with its endpoint moved when no correction names it.
 */
export function correctCatalogModel(provider: string, model: Model<Api>): Model<Api> {
  const correction = CORRECTIONS[provider]?.[model.id]
  const baseUrl = model.baseUrl.replace(ZEN_BASE, INFERENCE_BASE)
  if (correction === undefined) return { ...model, baseUrl }
  return { ...model, ...correction, baseUrl, cost: { ...model.cost, ...correction.cost } }
}

/**
 * The installed ids a route no longer serves, hidden from its catalog.
 * @param provider - provider route key.
 * @returns the retired model ids; empty for a route with none.
 */
export function retiredCatalogIds(provider: string): readonly string[] {
  return RETIRED[provider] ?? []
}
