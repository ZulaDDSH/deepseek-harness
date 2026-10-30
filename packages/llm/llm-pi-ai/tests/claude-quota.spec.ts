import { afterEach, describe, expect, it, vi } from 'vitest'
import { claudeObservationsFromHeaders, createClaudeQuotaSource, createClaudeUsage } from '../src/claude-quota.ts'
import { memoryAuth } from './auth-double.ts'

const subscription = { type: 'oauth' as const, access: 'access-test', refresh: 'refresh-test', expires: Date.now() + 3_600_000 }
const fakeKey = ['fake', 'claude', 'key'].join('-')
const offline: typeof fetch = async () => { throw new Error('Claude usage makes no network request') }
const USAGE_BODY = {
  five_hour: { utilization: 37, resets_at: '2026-10-15T20:00:00Z' },
  seven_day: { utilization: 0.5, resets_at: '2026-10-20T00:00:00Z' },
  seven_day_opus: { utilization: 81.5, resets_at: '2026-10-20T00:00:00Z' },
  seven_day_sonnet: null,
  extra_usage: { is_enabled: true, utilization: 12 },
}

function usageFetch(body: unknown = USAGE_BODY, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }))
}

afterEach(() => { vi.useRealTimers() })

function claudeSource(options: {
  record?: Parameters<typeof memoryAuth>[0]
  apiKeyEnv?: string
  route?: string
  stored?: readonly string[]
  usage?: ReturnType<typeof createClaudeUsage>
  fetch?: typeof fetch
  env?: Record<string, string>
} = {}) {
  const auth = memoryAuth(options.record ?? {})
  const source = createClaudeQuotaSource({
    usage: options.usage ?? createClaudeUsage(),
    auth: options.env === undefined ? auth : { ...auth, authContext: { ...auth.authContext, env: async name => options.env?.[name] } },
    apiKeyEnv: () => options.apiKeyEnv,
    keyStored: async ref => options.stored?.includes(ref) ?? false,
    settingsNs: 'llm-pi-ai',
    ...options.route === undefined ? {} : { route: options.route, name: 'Claude (work)' },
  })
  return { fetch: () => source.fetch(options.fetch ?? offline) }
}

describe('Claude unified-limit headers', () => {
  it('reads the five-hour and weekly windows from a response', () => {
    expect(claudeObservationsFromHeaders('anthropic', {
      'anthropic-ratelimit-unified-5h-utilization': '0.42',
      'anthropic-ratelimit-unified-5h-reset': '1800000000',
      'anthropic-ratelimit-unified-7d-utilization': '0.9',
    }, 1_000)).toEqual([
      { route: 'anthropic', window: 'five_hour', utilization: 0.42, resetAt: 1_800_000_000_000, observedAt: 1_000 },
      { route: 'anthropic', window: 'seven_day', utilization: 0.9, observedAt: 1_000 },
    ])
  })

  it('matches header names regardless of case and reads RFC 3339 resets', () => {
    expect(claudeObservationsFromHeaders('anthropic', {
      'Anthropic-RateLimit-Unified-5h-Reset': '2026-10-15T20:00:00Z',
    }, 1_000)).toEqual([
      { route: 'anthropic', window: 'five_hour', resetAt: Date.parse('2026-10-15T20:00:00Z'), observedAt: 1_000 },
    ])
  })

  it('reads a reset given as seconds from now, and a utilization given as a percent', () => {
    expect(claudeObservationsFromHeaders('anthropic', {
      'anthropic-ratelimit-unified-5h-utilization': '42',
      'anthropic-ratelimit-unified-5h-reset': '3600',
    }, 1_000)).toEqual([
      { route: 'anthropic', window: 'five_hour', utilization: 42, resetAt: 1_000 + 3_600_000, observedAt: 1_000 },
    ])
  })

  it('reports nothing for responses without unified limits', () => {
    expect(claudeObservationsFromHeaders('anthropic', { 'anthropic-ratelimit-requests-remaining': '5' }, 1_000)).toEqual([])
  })
})

describe('Claude window store', () => {
  it('keeps the latest value per window and maps SDK window types to quota windows', () => {
    const usage = createClaudeUsage()
    usage.observe({ route: 'anthropic', window: 'five_hour', utilization: 0.5, resetAt: 1_800_000_000_000, observedAt: 1_000 })
    usage.observe({ route: 'anthropic', window: 'five_hour', utilization: 0.92, resetAt: 1_800_000_000_000, observedAt: 2_000 })
    usage.observe({ route: 'anthropic', window: 'seven_day_opus', utilization: 0.3, observedAt: 1_500 })
    usage.observe({ route: 'anthropic', window: 'overage', utilization: 1, status: 'rejected', observedAt: 1_700 })
    usage.observe({ route: 'anthropic', window: 'seven_day_overage_included', utilization: 0.2, observedAt: 1_800 })
    usage.observe({ route: 'openai', window: 'five_hour', utilization: 0.99, observedAt: 1_900 })
    expect(usage.snapshot()).toEqual({
      windows: {
        '5h': { usedPercent: 92, resetAt: 1_800_000_000_000 },
        'weekly-opus': { usedPercent: 30, resetAt: null },
        overage: { usedPercent: 100, resetAt: null, status: 'rejected' },
      },
      asOf: 2_000,
    })
  })

  it('reads a utilization above 1 as whole percent', () => {
    const usage = createClaudeUsage()
    usage.observe({ route: 'anthropic', window: 'seven_day', utilization: 87.5, observedAt: 1_000 })
    usage.observe({ route: 'anthropic', window: 'five_hour', utilization: 1, observedAt: 1_000 })
    expect(usage.snapshot().windows).toEqual({ weekly: { usedPercent: 87.5, resetAt: null }, '5h': { usedPercent: 100, resetAt: null } })
  })

  it('drops a window once its reset has passed', () => {
    const usage = createClaudeUsage()
    usage.observe({ route: 'anthropic', window: 'five_hour', status: 'rejected', resetAt: 5_000, observedAt: 1_000 })
    usage.observe({ route: 'anthropic', window: 'seven_day', utilization: 0.5, resetAt: 9_000, observedAt: 1_000 })
    expect(Object.keys(usage.snapshot(4_999).windows)).toEqual(['5h', 'weekly'])
    expect(usage.snapshot(5_000).windows).toEqual({ weekly: { usedPercent: 50, resetAt: 9_000 } })
  })

  it('reports no windows before any observation', () => {
    expect(createClaudeUsage().snapshot()).toEqual({ windows: {} })
  })
})

describe('Claude quota source', () => {
  it('is not configured without a sign-in or a stored key', async () => {
    await expect(claudeSource().fetch()).resolves.toEqual({
      providerId: 'anthropic', providerName: 'Anthropic (Claude)', configured: false, ok: false, error: 'Not configured',
    })
  })

  it('bills the subscription and names why its usage could not be read', async () => {
    await expect(claudeSource({ record: { anthropic: subscription }, fetch: usageFetch({}, 404) }).fetch()).resolves.toEqual({
      providerId: 'anthropic',
      providerName: 'Anthropic (Claude)',
      configured: true,
      ok: true,
      windows: {},
      subscriptionError: 'Claude usage API returned HTTP 404',
      billing: {
        active: 'subscription',
        consoleUrl: 'https://platform.claude.com/settings/billing',
        switch: { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], apiKeyRef: 'ANTHROPIC_API_KEY', apiKeyStored: false },
      },
    })
  })

  it('shows observed windows with the time they were observed when the usage endpoint fails', async () => {
    const usage = createClaudeUsage()
    usage.observe({ route: 'anthropic', window: 'seven_day', utilization: 0.4, resetAt: 1_800_000_000_000, observedAt: 3_000 })
    const result = await claudeSource({ record: { anthropic: subscription }, usage, fetch: usageFetch({}, 503) }).fetch()
    expect(result).toMatchObject({
      ok: true, asOf: 3_000, windows: { weekly: { usedPercent: 40, resetAt: 1_800_000_000_000 } },
      subscriptionError: 'Claude usage API returned HTTP 503',
    })
    expect(result).not.toHaveProperty('awaitingUsage')
  })

  it('bills API credits when the route names a key, and keeps the subscription switch back', async () => {
    const result = await claudeSource({
      record: { anthropic: subscription }, apiKeyEnv: 'CLAUDE_KEY_TEST', stored: ['CLAUDE_KEY_TEST'], fetch: usageFetch(),
    }).fetch()
    expect(result).toMatchObject({
      configured: true,
      ok: true,
      billing: {
        active: 'api',
        switch: { settingsPath: ['providers', 'anthropic'], apiKeyRef: 'CLAUDE_KEY_TEST', apiKeyStored: true },
      },
    })
    expect(result).not.toHaveProperty('awaitingUsage')
  })

  it('shows windows a Claude Code run observed without a harness sign-in, and keeps the switch', async () => {
    const usage = createClaudeUsage()
    usage.observe({ route: 'anthropic', window: 'seven_day', utilization: 0.95, resetAt: 4_102_444_800_000, observedAt: 3_000 })
    const result = await claudeSource({ usage, stored: ['ANTHROPIC_API_KEY'] }).fetch()
    expect(result).toMatchObject({
      configured: true,
      ok: true,
      windows: { weekly: { usedPercent: 95 } },
      billing: { active: 'subscription', switch: { settingsPath: ['providers', 'anthropic'], apiKeyRef: 'ANTHROPIC_API_KEY', apiKeyStored: true } },
    })
  })

  it('signs in with an API key without a billing switch or subscription windows', async () => {
    const result = await claudeSource({ record: { anthropic: { type: 'api_key', key: fakeKey } } }).fetch()
    expect(result).toEqual({
      providerId: 'anthropic', providerName: 'Anthropic (Claude)', configured: true, ok: true, windows: {},
      billing: { active: 'api', consoleUrl: 'https://platform.claude.com/settings/billing' },
    })
  })

  it('reads an alias account windows from the alias sign-in, not the base account', async () => {
    const fetchImpl = usageFetch()
    const result = await claudeSource({
      route: 'claude-work',
      record: { 'claude-work': { ...subscription, access: 'work-access' } },
      fetch: fetchImpl,
    }).fetch()
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer work-access' })
    expect(result).toMatchObject({ providerId: 'claude-work', providerName: 'Claude (work)', ok: true, windows: { '5h': { usedPercent: 37 } } })
  })

  it('reads the subscription windows from the sign-in without any earlier request', async () => {
    const fetchImpl = usageFetch()
    const result = await claudeSource({ record: { anthropic: subscription }, fetch: fetchImpl }).fetch()
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-test', 'anthropic-beta': 'oauth-2025-04-20' })
    expect(result).toMatchObject({
      ok: true,
      windows: {
        '5h': { usedPercent: 37, resetAt: Date.parse('2026-10-15T20:00:00Z') },
        weekly: { usedPercent: 0.5, resetAt: Date.parse('2026-10-20T00:00:00Z') },
        'weekly-opus': { usedPercent: 81.5 },
        overage: { usedPercent: 12, resetAt: null },
      },
      billing: { active: 'subscription' },
    })
    expect(result.windows).not.toHaveProperty('weekly-sonnet')
    expect(result.asOf).toBeGreaterThan(0)
    expect(result).not.toHaveProperty('awaitingUsage')
    expect(result).not.toHaveProperty('subscriptionError')
  })

  it('prefers the usage endpoint over an older response header observation', async () => {
    const usage = createClaudeUsage()
    usage.observe({ route: 'anthropic', window: 'five_hour', utilization: 0.05, resetAt: 4_102_444_800_000, observedAt: 1_000 })
    usage.observe({ route: 'anthropic', window: 'seven_day_sonnet', utilization: 0.4, observedAt: 1_000 })
    const result = await claudeSource({ record: { anthropic: subscription }, usage, fetch: usageFetch() }).fetch()
    expect(result.windows?.['5h']?.usedPercent).toBe(37)
    expect(result.windows?.['weekly-sonnet']).toMatchObject({ usedPercent: 40 })
  })

  it('shows the subscription windows while API credits are the source requests use', async () => {
    const result = await claudeSource({
      record: { anthropic: subscription }, apiKeyEnv: 'CLAUDE_KEY_TEST', stored: ['CLAUDE_KEY_TEST'], fetch: usageFetch(),
    }).fetch()
    expect(result).toMatchObject({ windows: { '5h': { usedPercent: 37 } }, billing: { active: 'api', switch: { apiKeyStored: true } } })
  })

  it('does not call the usage endpoint for an API-key sign-in or an environment key', async () => {
    const fetchImpl = usageFetch()
    await claudeSource({ record: { anthropic: { type: 'api_key', key: fakeKey } }, fetch: fetchImpl }).fetch()
    await claudeSource({ env: { ANTHROPIC_API_KEY: fakeKey }, fetch: fetchImpl }).fetch()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('names an unparseable or refused usage reply instead of claiming the first request is pending', async () => {
    const unparseable = await claudeSource({ record: { anthropic: subscription }, fetch: usageFetch({ five_hour: 'x' }) }).fetch()
    expect(unparseable).toMatchObject({ ok: true, subscriptionError: 'Claude usage windows unavailable' })
    expect(unparseable).not.toHaveProperty('awaitingUsage')
    const garbled = await claudeSource({ record: { anthropic: subscription }, fetch: async () => new Response('<html>') }).fetch()
    expect(garbled).toMatchObject({ subscriptionError: 'Claude usage data could not be parsed' })
    const denied = await claudeSource({ record: { anthropic: subscription }, fetch: usageFetch({}, 403) }).fetch()
    expect(denied).toMatchObject({ subscriptionError: 'Claude usage API returned HTTP 403' })
    const down = await claudeSource({ record: { anthropic: subscription }, fetch: offline }).fetch()
    expect(down).toMatchObject({ subscriptionError: 'Claude usage request failed' })
  })

  it('reads a usage reply that reports fractions as percentages', async () => {
    const result = await claudeSource({
      record: { anthropic: subscription },
      fetch: usageFetch({ five_hour: { utilization: 0.37, resets_at: null }, seven_day: { utilization: 0.5, resets_at: null } }),
    }).fetch()
    expect(result.windows).toMatchObject({ '5h': { usedPercent: 37 }, weekly: { usedPercent: 50 } })
  })

  it('reuses a usage reply for a minute, then asks again', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const fetchImpl = usageFetch()
    const source = claudeSource({ record: { anthropic: subscription }, fetch: fetchImpl })
    await source.fetch()
    vi.setSystemTime(1_059_000)
    await source.fetch()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    vi.setSystemTime(1_061_000)
    await source.fetch()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('bills API credits for an environment key when nothing is stored, and the subscription for a bearer token', async () => {
    const api = await claudeSource({ env: { ANTHROPIC_API_KEY: fakeKey } }).fetch()
    expect(api).toMatchObject({ configured: true, ok: true, billing: { active: 'api' } })
    expect(api).not.toHaveProperty('awaitingUsage')
    const bearer = await claudeSource({ env: { ANTHROPIC_OAUTH_TOKEN: fakeKey } }).fetch()
    expect(bearer).toMatchObject({ configured: true, billing: { active: 'subscription' }, awaitingUsage: true })
  })

  it('reports a spend-limit refusal until the provider date, and for a day when it named none', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const usage = createClaudeUsage()
    usage.observeApiLimit({ resetAt: 50_000, observedAt: 10_000 })
    const source = claudeSource({ record: { anthropic: { type: 'api_key', key: fakeKey } }, usage })
    await expect(source.fetch()).resolves.toMatchObject({ apiLimit: { resetAt: 50_000, observedAt: 10_000 } })
    vi.setSystemTime(50_000)
    expect(await source.fetch()).not.toHaveProperty('apiLimit')
    usage.observeApiLimit({ resetAt: null, observedAt: 60_000 })
    vi.setSystemTime(60_000 + 86_399_000)
    expect(await source.fetch()).toHaveProperty('apiLimit')
    vi.setSystemTime(60_000 + 86_400_000)
    expect(await source.fetch()).not.toHaveProperty('apiLimit')
  })

  it('reports a credential read failure as a failed result', async () => {
    const auth = { credentials: { read: async () => { throw new Error('credential store offline') } }, authContext: {} }
    const result = await createClaudeQuotaSource({
      usage: createClaudeUsage(), auth: auth as never, apiKeyEnv: () => undefined, keyStored: async () => false, settingsNs: 'llm-pi-ai',
    }).fetch(offline)
    expect(result).toMatchObject({ configured: true, ok: false, error: 'credential store offline' })
  })
})
