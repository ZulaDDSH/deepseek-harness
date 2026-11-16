// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render } from '@testing-library/react'
import type { QuotaResult } from '@deepseek-ai/dsh-api-quota-controller/types'
import { en } from '../src/client/locales.ts'
import { instantLabel, ProviderQuotaAction } from '../src/client/ProviderQuotaAction.tsx'
import type { ProviderQuotaActionProps } from '../src/client/ProviderQuotaAction.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function translate(key: string, params?: Record<string, string>): string {
  const template = (en as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? `{${name}}`)
}

function renderPopover(results: readonly QuotaResult[], providers = [{ id: 'opencode-go', name: 'OpenCode Go' }], overrides: Partial<ProviderQuotaActionProps> = {}) {
  const props = {
    useProviders: (select: (value: unknown) => unknown) => select(providers),
    useState: (select: (value: unknown) => unknown) => select({ status: 'ready' as const, results }),
    useProjection: () => undefined,
    refresh: vi.fn(async () => {}),
    switchBilling: vi.fn(async () => undefined),
    t: translate,
    ...overrides,
  } as ProviderQuotaActionProps
  const view = render(<ProviderQuotaAction {...props} />)
  fireEvent.click(view.getByRole('button', { name: en.title }))
  return view
}

describe('ProviderQuotaAction popover', () => {
  it('refreshes on opening and on request, and closes without refreshing', () => {
    const refresh = vi.fn(async () => {})
    const view = renderPopover([], undefined, { refresh })
    expect(refresh).toHaveBeenCalledOnce()
    fireEvent.click(view.getByRole('button', { name: en.refresh }))
    expect(refresh).toHaveBeenCalledTimes(2)
    fireEvent.click(view.getByRole('button', { name: en.title }))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('closes on Escape, consumes the key, and returns focus to the trigger', () => {
    const view = renderPopover([])
    const trigger = view.getByRole('button', { name: en.title })
    const event = createEvent.keyDown(document, { key: 'Escape' })
    fireEvent(document, event)
    expect(view.queryByRole('dialog')).toBeNull()
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on an outside press but not on a press inside the popover', () => {
    const view = renderPopover([])
    fireEvent.pointerDown(view.getByRole('dialog'))
    expect(view.getByRole('dialog')).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it.each(['loading', 'error'] as const)('renders %s without results', (status) => {
    const refresh = vi.fn(async () => {})
    const view = renderPopover([], undefined, { refresh, useState: select => select({ status, results: [] }) })
    expect(view.getByText(status === 'loading' ? en.loading : translate('error', { message: en.unavailable }))).toBeDefined()
    expect(refresh).toHaveBeenCalledTimes(status === 'loading' ? 0 : 1)
  })

  it('reports explicit request failure text and empty provider directories', () => {
    const view = renderPopover([], undefined, {
      useState: select => select({ status: 'error', results: [], message: 'offline' }),
    })
    expect(view.getByText(translate('error', { message: 'offline' }))).toBeDefined()
    cleanup()
    expect(renderPopover([], []).getByText(en.empty)).toBeDefined()
  })

  it('shows loading before provider discovery and unavailable after an empty result', () => {
    expect(renderPopover([], undefined, { useProviders: select => select(null) }).getByText(en.loading)).toBeDefined()
    cleanup()
    expect(renderPopover([]).getByText(en.unavailable)).toBeDefined()
  })

  it('renders warning usage and tolerates windows without a metric or reset', () => {
    const view = renderPopover([{
      providerId: 'fixture', providerName: 'Fixture', configured: true, ok: true,
      windows: {
        '5h': { usedPercent: 50.4, resetAt: Number.NaN, status: 'OK' },
        monthly: { usedPercent: null, resetAt: null },
      },
    }, { providerId: 'other', providerName: 'Other', configured: true, ok: true }])
    expect(view.getByText('50% used').className).toContain('warn')
    expect(view.getByText(en['window.monthly'])).toBeDefined()
    expect(view.queryByText(/^Resets /)).toBeNull()
    expect(view.getByText(en.unavailable)).toBeDefined()
  })

  it('shows every window with its metric and reset time', () => {
    const view = renderPopover([{
      providerId: 'opencode-go', providerName: 'OpenCode Go', configured: true, ok: true,
      windows: {
        '5h': { usedPercent: 12, resetAt: Date.UTC(2026, 8, 19, 4, 10) },
        weekly: { usedPercent: 91, resetAt: Date.UTC(2026, 8, 20, 20, 0) },
      },
    }])

    expect(view.getByText('OpenCode Go')).toBeDefined()
    expect(view.getByText('5 hours')).toBeDefined()
    expect(view.getByText('12% used')).toBeDefined()
    expect(view.getByText('Weekly')).toBeDefined()
    expect(view.getByText('91% used')).toBeDefined()
    // Reset instants render (locale-formatted), so the window is not just a bare percentage.
    expect(view.getAllByText(/^Resets /)).toHaveLength(2)
  })

  it('renders a credit balance window from its own value label', () => {
    const view = renderPopover([{
      providerId: 'opencode-go', providerName: 'OpenCode Go', configured: true, ok: true,
      windows: { credits: { usedPercent: null, resetAt: null, valueLabel: '$0.00' } },
    }])

    expect(view.getByText('Credits')).toBeDefined()
    expect(view.getByText('$0.00')).toBeDefined()
  })

  it('shows the durable current-session token total alongside account quotas', () => {
    const props = {
      useProviders: (select: (value: unknown) => unknown) => select([{ id: 'deepseek', name: 'DeepSeek' }]),
      useState: (select: (value: unknown) => unknown) => select({ status: 'ready' as const, results: [] }),
      useProjection: (key: string) => key === 'tokenUsage' ? { uncachedInputTokens: 100, outputTokens: 25, cacheReadTokens: 50, cacheWriteTokens: 5 } : undefined,
      refresh: vi.fn(async () => {}),
      t: translate,
    } as ProviderQuotaActionProps
    const view = render(<ProviderQuotaAction {...props} />)
    fireEvent.click(view.getByRole('button', { name: en.title }))
    expect(view.getByText('This session: 180 tokens')).toBeDefined()
  })
  it('shows a non-ok window status verbatim instead of the percentage', () => {
    const view = renderPopover([{
      providerId: 'opencode-go', providerName: 'OpenCode Go', configured: true, ok: true,
      windows: { weekly: { usedPercent: null, resetAt: null, status: 'rate-limited' } },
    }])

    expect(view.getByText('rate-limited')).toBeDefined()
    expect(view.queryByText(/used$/)).toBeNull()
  })

  it('asks a signed-in Claude provider with no usage yet for its first request', () => {
    const view = renderPopover([{
      providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: true, awaitingUsage: true,
    }], [{ id: 'anthropic', name: 'Anthropic' }])

    expect(view.getByText('Anthropic')).toBeDefined()
    expect(view.getByText(translate('awaitingUsage', { provider: 'Anthropic' }))).toBeDefined()
  })

  it('shows a signed-in provider when its account usage failed', () => {
    const view = renderPopover([{
      providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: false,
      error: 'Usage reporting is not available for this provider',
    }], [{ id: 'anthropic', name: 'Anthropic' }])

    expect(view.getByText('Anthropic')).toBeDefined()
    expect(view.getByText('Usage reporting is not available for this provider')).toBeDefined()
  })

  it('collapses unconfigured providers into one set-up line', () => {
    const view = renderPopover([
      { providerId: 'deepseek-official', providerName: 'DeepSeek', configured: false, ok: false, error: 'Set up DeepSeek in Settings > Models' },
      { providerId: 'opencode-go', providerName: 'OpenCode Go', configured: false, ok: false, error: 'Not configured' },
    ], [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'opencode-go', name: 'OpenCode Go' }])

    expect(view.getByText(translate('notSetUp', { providers: 'DeepSeek, OpenCode Go' }))).toBeDefined()
    expect(view.getByText(en.setUpHint)).toBeDefined()
    expect(view.queryByText('Set up DeepSeek in Settings > Models')).toBeNull()
    expect(view.queryByText('OpenCode Go')).toBeNull()
  })

  it('switches a subscription provider to API credits through its billing write', () => {
    const switchBilling = vi.fn(async () => undefined)
    const option = { settingsNs: 'llm', settingsPath: ['providers', 'anthropic'], apiKeyRef: 'ANTHROPIC_API_KEY', apiKeyStored: true }
    const view = renderPopover([{
      providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: true, awaitingUsage: true,
      billing: { active: 'subscription', switch: option },
    }], [{ id: 'anthropic', name: 'Anthropic' }], { switchBilling })

    fireEvent.click(view.getByRole('button', { name: translate('switchToApi', { provider: 'Anthropic' }) }))
    expect(switchBilling).toHaveBeenCalledWith(option, 'api', 'anthropic')
  })

  it('offers a key instead of a switch when the API key is not stored', () => {
    const view = renderPopover([{
      providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: true, awaitingUsage: true,
      billing: { active: 'subscription', switch: { settingsNs: 'llm', settingsPath: ['providers', 'anthropic'], apiKeyRef: 'ANTHROPIC_API_KEY', apiKeyStored: false } },
    }], [{ id: 'anthropic', name: 'Anthropic' }])

    expect(view.getByText(translate('addKeyToSwitch', { provider: 'Anthropic' }))).toBeDefined()
    expect(view.queryByRole('button', { name: translate('switchToApi', { provider: 'Anthropic' }) })).toBeNull()
  })

  it('uses generic billing wording for a provider other than Claude', () => {
    const view = renderPopover([{
      providerId: 'openai-codex', providerName: 'OpenAI Codex', configured: true, ok: true,
      windows: { '5h': { usedPercent: 10, resetAt: null } },
      billing: { active: 'api', switch: { settingsNs: 'llm', settingsPath: ['providers', 'openai-codex'], apiKeyRef: 'OPENAI_API_KEY', apiKeyStored: true } },
    }], [{ id: 'openai-codex', name: 'OpenAI Codex' }])

    expect(view.getByText(translate('billingUsing', { source: translate('billingApi', { provider: 'OpenAI Codex' }) }))).toBeDefined()
    expect(view.getByRole('button', { name: translate('switchToSubscription', { provider: 'OpenAI Codex' }) })).toBeDefined()
    expect(view.getByRole('dialog').textContent).not.toContain('Claude')
  })

  it('names the billing source and links the console the provider reports', () => {
    const view = renderPopover([{
      providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: true,
      windows: { '5h': { usedPercent: 10, resetAt: null } }, billing: { active: 'api', consoleUrl: 'https://platform.claude.com/settings/billing' },
    }], [{ id: 'anthropic', name: 'Anthropic' }])

    expect(view.getByText(translate('billingUsing', { source: translate('billingApi', { provider: 'Anthropic' }) }))).toBeDefined()
    expect(view.getByRole('link', { name: translate('consoleLink', { provider: 'Anthropic' }) }).getAttribute('href')).toBe('https://platform.claude.com/settings/billing')
  })
  it('shows no console link when the billing metadata reports none', () => {
    const view = renderPopover([{
      providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: true,
      windows: { '5h': { usedPercent: 10, resetAt: null } }, billing: { active: 'api' },
    }], [{ id: 'anthropic', name: 'Anthropic' }])

    expect(view.queryByRole('link')).toBeNull()
  })
  it('shows the subscription windows and the API spending limit together, marking the source requests use', () => {
    const resetAt = Date.UTC(2999, 10, 1)
    const view = renderPopover([{
      providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: true,
      windows: { '5h': { usedPercent: 37, resetAt: null }, weekly: { usedPercent: 12, resetAt: null }, 'weekly-opus': { usedPercent: 81, resetAt: null } },
      asOf: Date.UTC(2026, 9, 15), apiLimit: { resetAt, observedAt: Date.UTC(2026, 9, 15) },
      billing: { active: 'api', switch: { settingsNs: 'llm', settingsPath: ['providers', 'anthropic'], apiKeyRef: 'ANTHROPIC_API_KEY', apiKeyStored: true } },
    }], [{ id: 'anthropic', name: 'Anthropic' }])

    const subscription = view.getByText(translate('billingSubscription', { provider: 'Anthropic' }))
    const credits = view.getByText(translate('billingApi', { provider: 'Anthropic' }))
    expect(view.getAllByText(en.inUseForRequests)).toHaveLength(1)
    expect(credits.parentElement?.textContent).toContain(en.inUseForRequests)
    expect(subscription.parentElement?.textContent).not.toContain(en.inUseForRequests)
    expect(view.getByText('37% used')).toBeDefined()
    expect(view.getByText('81% used')).toBeDefined()
    expect(view.getByText(translate('apiLimitUntil', { time: instantLabel(resetAt) }))).toBeDefined()
    expect(view.queryByText(translate('apiLimitMismatch', { provider: 'Anthropic' }))).toBeNull()
  })

  it('warns when a spending limit was hit while billing is set to the subscription', () => {
    const view = renderPopover([{
      providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: true,
      windows: { '5h': { usedPercent: 1, resetAt: null } }, apiLimit: { resetAt: null, observedAt: 1 },
      billing: { active: 'subscription', switch: { settingsNs: 'llm', settingsPath: ['providers', 'anthropic'], apiKeyRef: 'ANTHROPIC_API_KEY', apiKeyStored: true } },
    }], [{ id: 'anthropic', name: 'Anthropic' }])

    expect(view.getByText(en.apiLimitNoDate)).toBeDefined()
    expect(view.getByText(translate('apiLimitMismatch', { provider: 'Anthropic' }))).toBeDefined()
    expect(view.getAllByText(en.inUseForRequests)).toHaveLength(1)
  })

  it('names why subscription usage is unavailable instead of waiting for a request', () => {
    const view = renderPopover([{
      providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: true, windows: {},
      subscriptionError: 'Claude usage API returned HTTP 403',
      billing: { active: 'subscription', switch: { settingsNs: 'llm', settingsPath: ['providers', 'anthropic'], apiKeyRef: 'ANTHROPIC_API_KEY', apiKeyStored: true } },
    }], [{ id: 'anthropic', name: 'Anthropic' }])

    expect(view.getByText(translate('subscriptionUnavailable', { message: 'Claude usage API returned HTTP 403' }))).toBeDefined()
    expect(view.queryByText(translate('awaitingUsage', { provider: 'Anthropic' }))).toBeNull()
  })

  it('keeps showing older windows beside the reason the live read failed', () => {
    const view = renderPopover([{
      providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: true,
      windows: { weekly: { usedPercent: 40, resetAt: null } }, asOf: Date.UTC(2026, 9, 15), subscriptionError: 'Claude usage API returned HTTP 429',
      billing: { active: 'subscription', switch: { settingsNs: 'llm', settingsPath: ['providers', 'anthropic'], apiKeyRef: 'ANTHROPIC_API_KEY', apiKeyStored: true } },
    }], [{ id: 'anthropic', name: 'Anthropic' }])

    expect(view.getByText('40% used')).toBeDefined()
    expect(view.getByText(translate('asOf', { time: instantLabel(Date.UTC(2026, 9, 15)) }))).toBeDefined()
    expect(view.getByText(translate('subscriptionUnavailable', { message: 'Claude usage API returned HTTP 429' }))).toBeDefined()
  })

  it('shows real model token counts separately from shared account quotas', () => {
    const view = renderPopover([], undefined, { useProjection: (key: string) => key === 'modelUsage' ? [
      { provider: 'anthropic', model: 'claude-sonnet-5-5', usage: { uncachedInputTokens: 100, outputTokens: 25, cacheReadTokens: 50, cacheWriteTokens: 5 } },
    ] : undefined })
    expect(view.getByText('anthropic / claude-sonnet-5-5: 180 tokens')).toBeDefined()
    expect(view.getByText(en.accountQuota)).toBeDefined()
  })
  it('puts the selected model provider account first without duplicating it', () => {
    const view = renderPopover([
      { providerId: 'opencode-go', providerName: 'OpenCode Go', configured: true, ok: true },
      { providerId: 'openai-codex', providerName: 'OpenAI Codex', configured: true, ok: true },
    ], undefined, { useProjection: (key: string) => key === 'modelSelection' ? { next: { provider: 'openai-codex', model: 'gpt-6.1-sol' } } : undefined })
    const names = Array.from(view.getByRole('dialog').querySelectorAll('section > header')).map(header => header.textContent)
    expect(names).toEqual([en.accountQuota, 'OpenAI Codex', 'OpenCode Go'])
    expect(view.getAllByText('OpenAI Codex')).toHaveLength(1)
  })

})
