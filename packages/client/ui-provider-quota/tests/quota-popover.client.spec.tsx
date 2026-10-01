// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { QuotaResult } from '@deepseek-ai/dsh-api-quota-controller/types'
import { en } from '../src/client/locales.ts'
import { ProviderQuotaAction } from '../src/client/ProviderQuotaAction.tsx'
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

  it('shows a connected provider when account usage is unavailable', () => {
    const view = renderPopover([{
      providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: false,
      error: 'Usage reporting is not available for this provider',
    }], [{ id: 'anthropic', name: 'Anthropic' }])

    expect(view.getByText('Anthropic')).toBeDefined()
    expect(view.getByText('Usage reporting is not available for this provider')).toBeDefined()
  })
  it('shows real model token counts separately from shared account quotas', () => {
    const view = renderPopover([], undefined, { useProjection: (key: string) => key === 'modelUsage' ? [
      { provider: 'anthropic', model: 'claude-sonnet-5-5', usage: { uncachedInputTokens: 100, outputTokens: 25, cacheReadTokens: 50, cacheWriteTokens: 5 } },
    ] : undefined })
    expect(view.getByText('anthropic / claude-sonnet-5-5: 180 tokens')).toBeDefined()
    expect(view.getByText(en.accountQuota)).toBeDefined()
  })
})
