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

function renderPopover(results: readonly QuotaResult[], providers = [{ id: 'opencode-go', name: 'OpenCode Go' }]) {
  const props = {
    useProviders: (select: (value: unknown) => unknown) => select(providers),
    useState: (select: (value: unknown) => unknown) => select({ status: 'ready' as const, results }),
    useProjection: () => undefined,
    refresh: vi.fn(async () => {}),
    t: translate,
  } as unknown as ProviderQuotaActionProps
  const view = render(<ProviderQuotaAction {...props} />)
  fireEvent.click(view.getByRole('button', { name: en.title }))
  return view
}

describe('ProviderQuotaAction popover', () => {
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
      useProjection: () => ({ uncachedInputTokens: 100, outputTokens: 25, cacheReadTokens: 50, cacheWriteTokens: 5 }),
      refresh: vi.fn(async () => {}),
      t: translate,
    } as unknown as ProviderQuotaActionProps
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
})
