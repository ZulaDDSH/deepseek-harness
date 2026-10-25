import { describe, expect, it } from 'vitest'
import type { QuotaBilling, QuotaBillingSwitch, QuotaResult } from '@deepseek-ai/dsh-api-quota-controller/types'
import { hardLimited, localUsagePromptStore, NEAR_LIMIT_PERCENT, OPEN_WINDOW_HOLD_MS, usagePrompt, withDismissed } from '../src/client/usage-prompt.ts'
import type { UsageSwitch } from '../src/client/usage-prompt.ts'

const NOW = Date.UTC(2026, 9, 15, 12, 0)
const RESET = Date.UTC(2026, 9, 20, 12, 0)
const switchOption: QuotaBillingSwitch = { settingsNs: 'llm', settingsPath: ['providers', 'anthropic'], apiKeyRef: 'ANTHROPIC_API_KEY', apiKeyStored: true }
const apiCredits: QuotaBilling = { active: 'api', switch: switchOption }

function claude(windows: NonNullable<QuotaResult['windows']>, billing?: QuotaBilling): QuotaResult {
  return { providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: true, windows, ...billing === undefined ? {} : { billing } }
}

interface DecideOptions {
  dismissed?: readonly string[]
  switched?: UsageSwitch
  now?: number
  nearLimitPercent?: number
}

function decide(results: readonly QuotaResult[], options: DecideOptions = {}) {
  return usagePrompt(results, {
    dismissed: new Set(options.dismissed),
    ...options.switched === undefined ? {} : { switched: options.switched },
    ...options.nearLimitPercent === undefined ? {} : { nearLimitPercent: options.nearLimitPercent },
    now: options.now ?? NOW,
  })
}

describe('usage prompt decisions', () => {
  it('prompts at the near-limit share and not below it', () => {
    expect(NEAR_LIMIT_PERCENT).toBe(90)
    expect(decide([claude({ '5h': { usedPercent: 89, resetAt: RESET } })])).toBeUndefined()
    expect(decide([claude({ '5h': { usedPercent: 90, resetAt: RESET } })])).toMatchObject({ kind: 'near-limit', windowId: '5h', key: `limit|anthropic|5h|${RESET}` })
  })

  it('uses a configured near-limit share and defaults to 90', () => {
    const results = [claude({ '5h': { usedPercent: 85, resetAt: RESET } })]
    expect(decide(results)).toBeUndefined()
    expect(decide(results, { nearLimitPercent: 80 })).toMatchObject({ kind: 'near-limit', windowId: '5h' })
    expect(decide(results, { nearLimitPercent: 90 })).toBeUndefined()
  })

  it('raises one prompt for the most prominent window that is near its limit', () => {
    const prompt = decide([claude({
      '5h': { usedPercent: 99, resetAt: RESET },
      weekly: { usedPercent: 95, resetAt: RESET },
      monthly: { usedPercent: 92, resetAt: RESET },
    })])
    expect(prompt).toMatchObject({ kind: 'near-limit', windowId: 'monthly' })
  })

  it('puts a hard limit ahead of a near-limit window', () => {
    const prompt = decide([claude({
      monthly: { usedPercent: 92, resetAt: RESET },
      '5h': { usedPercent: 10, resetAt: RESET, status: 'rejected' },
    })])
    expect(prompt).toMatchObject({ kind: 'hard-limit', windowId: '5h' })
  })

  it('reports a non-ok provider status as a hard limit at any percentage', () => {
    expect(hardLimited({ usedPercent: 3, resetAt: RESET, status: 'rate-limited' })).toBe(true)
    expect(hardLimited({ usedPercent: 3, resetAt: RESET, status: 'OK' })).toBe(false)
    expect(decide([claude({ monthly: { usedPercent: 3, resetAt: RESET, status: 'rejected' } })])).toMatchObject({ kind: 'hard-limit', windowId: 'monthly' })
  })

  it('stays quiet while requests bill to API credits, for failed results, and for unconfigured providers', () => {
    expect(decide([claude({ monthly: { usedPercent: 99, resetAt: RESET } }, apiCredits)])).toBeUndefined()
    expect(decide([{ ...claude({ monthly: { usedPercent: 99, resetAt: RESET } }), ok: false }])).toBeUndefined()
    expect(decide([{ ...claude({ monthly: { usedPercent: 99, resetAt: RESET } }), configured: false }])).toBeUndefined()
  })

  it('ranks near-limit windows by length across providers, longest first', () => {
    const prompt = decide([
      claude({ weekly: { usedPercent: 95, resetAt: RESET } }),
      { providerId: 'openai-codex', providerName: 'OpenAI Codex', configured: true, ok: true, windows: { monthly: { usedPercent: 92, resetAt: RESET } } },
    ])
    expect(prompt).toMatchObject({ kind: 'near-limit', windowId: 'monthly', result: { providerId: 'openai-codex' } })
  })

  it('keeps a dismissed prompt quiet until its window resets', () => {
    const key = `limit|anthropic|5h|${RESET}`
    expect(decide([claude({ '5h': { usedPercent: 95, resetAt: RESET } })], { dismissed: [key] })).toBeUndefined()
    const nextReset = RESET + 5 * 3_600_000
    expect(decide([claude({ '5h': { usedPercent: 95, resetAt: nextReset } })], { dismissed: [key], now: RESET + 1 }))
      .toMatchObject({ kind: 'near-limit', key: `limit|anthropic|5h|${nextReset}` })
  })

  it('keeps a dismissed window with no reset time quiet for a day, then prompts again', () => {
    const results = [claude({ monthly: { usedPercent: 95, resetAt: null } })]
    const prompt = decide(results)
    expect(prompt).toMatchObject({ kind: 'near-limit', key: 'limit|anthropic|monthly|open' })
    const dismissed = withDismissed([], 'limit|anthropic|monthly|open', NOW)
    expect(dismissed).toEqual([`limit|anthropic|monthly|open|${NOW + OPEN_WINDOW_HOLD_MS}`])
    expect(decide(results, { dismissed, now: NOW + OPEN_WINDOW_HOLD_MS - 1 })).toBeUndefined()
    expect(decide(results, { dismissed, now: NOW + OPEN_WINDOW_HOLD_MS + 1 })).toMatchObject({ kind: 'near-limit' })
  })

  it('suppresses other windows and refreshed reset times for the dismissed provider until reset', () => {
    const dismissed = withDismissed([], `limit|anthropic|weekly|${RESET}`, NOW)
    const results = [claude({
      weekly: { usedPercent: 100, resetAt: RESET + 1000 },
      'weekly-opus': { usedPercent: 100, resetAt: RESET },
      '5h': { usedPercent: 100, resetAt: NOW + 3_600_000 },
    })]
    expect(decide(results, { dismissed })).toBeUndefined()
    expect(decide(results, { dismissed, now: RESET + 1 })).toMatchObject({ windowId: 'weekly' })
    expect(decide([...results, { ...claude({ weekly: { usedPercent: 100, resetAt: RESET } }), providerId: 'another' }], { dismissed }))
      .toMatchObject({ result: { providerId: 'another' } })
  })

  it('ignores stale usage windows whose reset has passed', () => {
    expect(decide([claude({ weekly: { usedPercent: 100, resetAt: NOW - 1 } })])).toBeUndefined()
  })

  it('offers the switch back once the switched window resets, and only once', () => {
    const switched: UsageSwitch = { providerId: 'anthropic', resetAt: RESET }
    const results = [claude({}, apiCredits)]
    expect(decide(results, { switched, now: RESET - 1 })).toBeUndefined()
    expect(decide(results, { switched, now: RESET })).toMatchObject({ kind: 'switch-back', key: `back|anthropic|${RESET}` })
    expect(decide(results, { switched, now: RESET, dismissed: [`back|anthropic|${RESET}`] })).toBeUndefined()
  })
})

describe('dismissed prompt memory', () => {
  it('drops lapsed keys and permanent open-ended ones, and does not duplicate', () => {
    const lapsed = `limit|anthropic|5h|${NOW - 1}`
    const live = `limit|anthropic|5h|${NOW + 1}`
    const permanent = 'limit|anthropic|5h|open'
    const next = `limit|anthropic|monthly|${RESET}`
    expect(withDismissed([lapsed, live, permanent], next, NOW)).toEqual([live, next])
    expect(withDismissed([live], live, NOW)).toEqual([live])
  })

  it('replaces an earlier dismissal of the same open-ended window instead of piling up', () => {
    const first = withDismissed([], 'limit|anthropic|5h|open', NOW)
    expect(withDismissed(first, 'limit|anthropic|5h|open', NOW + 1)).toEqual([`limit|anthropic|5h|open|${NOW + 1 + OPEN_WINDOW_HOLD_MS}`])
  })

  it('round-trips dismissals and the last switch through storage and ignores malformed values', () => {
    const data = new Map<string, string>()
    const store = localUsagePromptStore({
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value) },
      removeItem: (key: string) => { data.delete(key) },
    } as Storage)
    store.saveDismissed(['a'])
    store.saveSwitched({ providerId: 'anthropic', resetAt: RESET })
    expect(store.dismissed()).toEqual(['a'])
    expect(store.switched()).toEqual({ providerId: 'anthropic', resetAt: RESET })
    store.saveSwitched(undefined)
    expect(store.switched()).toBeUndefined()
    data.set('dsh.provider-quota.dismissed', '{not json')
    data.set('dsh.provider-quota.switched', '"anthropic"')
    expect(store.dismissed()).toEqual([])
    expect(store.switched()).toBeUndefined()
  })
})
