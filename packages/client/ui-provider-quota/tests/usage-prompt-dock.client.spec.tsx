// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { QuotaBilling, QuotaResult } from '@deepseek-ai/dsh-api-quota-controller/types'
import { en } from '../src/client/locales.ts'
import { UsageSwitchPrompt } from '../src/client/UsageSwitchPrompt.tsx'
import type { UsageSwitchPromptProps } from '../src/client/UsageSwitchPrompt.tsx'
import type { UsageSwitch } from '../src/client/usage-prompt.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const NOW = Date.now()
const RESET = NOW + 3 * 86_400_000
const PAST = NOW - 86_400_000
const CLAUDE = 'Anthropic (Claude)'
const option = { settingsNs: 'llm', settingsPath: ['providers', 'anthropic'], apiKeyRef: 'ANTHROPIC_API_KEY', apiKeyStored: true }
const subscription: QuotaBilling = { active: 'subscription', switch: option }

function translate(key: string, params?: Record<string, string>): string {
  const template = (en as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? `{${name}}`)
}

function claude(windows: NonNullable<QuotaResult['windows']>, billing?: QuotaBilling): QuotaResult {
  return { providerId: 'anthropic', providerName: CLAUDE, configured: true, ok: true, windows, ...billing === undefined ? {} : { billing } }
}

interface PromptOptions {
  switched?: UsageSwitch
  refreshValues?: () => Promise<void>
  nearLimitPercent?: number
}

function promptProps(results: readonly QuotaResult[], options: PromptOptions = {}) {
  return {
    useState: (select: (value: unknown) => unknown) => select({ status: 'ready' as const, results }),
    useDismissed: (select: (value: unknown) => unknown) => select([]),
    useSwitched: (select: (value: unknown) => unknown) => select(options.switched),
    useSession: (select: (value: unknown) => unknown) => select({ running: false }),
    dismiss: vi.fn(),
    switchBilling: vi.fn(async () => undefined),
    refreshValues: options.refreshValues ?? vi.fn(async () => {}),
    useNearLimit: (select: (value: unknown) => unknown) => select(options.nearLimitPercent ?? 90),
    t: translate,
  } as UsageSwitchPromptProps
}

function renderPrompt(results: readonly QuotaResult[], options?: PromptOptions) {
  const props = promptProps(results, options)
  return { props, view: render(<UsageSwitchPrompt {...props} />) }
}

describe('usage prompt in the composer dock', () => {
  it('names the window and percent of a near-limit and offers the provider API credits', () => {
    const { props, view } = renderPrompt([claude({ monthly: { usedPercent: 92, resetAt: RESET } }, subscription)])
    expect(view.getByRole('status').textContent).toContain(`Your ${CLAUDE} subscription is 92% used for the monthly window (resets `)
    fireEvent.click(view.getByRole('button', { name: translate('switchToApi', { provider: CLAUDE }) }))
    expect(props.switchBilling).toHaveBeenCalledWith(option, 'api', 'anthropic', RESET)
  })

  it('names a hard limit and still offers the switch', () => {
    const { view } = renderPrompt([claude({ '5h': { usedPercent: 40, resetAt: RESET, status: 'rejected' } }, subscription)])
    expect(view.getByRole('status').textContent).toContain('reached its limit for the five-hour window')
    expect(view.getByRole('button', { name: translate('switchToApi', { provider: CLAUDE }) })).toBeDefined()
  })

  it('without a stored API key says how to add one and never writes the billing choice', () => {
    const { props, view } = renderPrompt([claude({ monthly: { usedPercent: 95, resetAt: RESET } }, { active: 'subscription', switch: { ...option, apiKeyStored: false } })])
    expect(view.getByText(translate('addKeyToSwitch', { provider: CLAUDE }))).toBeDefined()
    expect(view.queryByRole('button', { name: translate('switchToApi', { provider: CLAUDE }) })).toBeNull()
    expect(props.switchBilling).not.toHaveBeenCalled()
  })

  it('answers a window with no reset time by remembering a one-day hold for the switch back', () => {
    const { props, view } = renderPrompt([claude({ monthly: { usedPercent: 95, resetAt: null } }, subscription)])
    fireEvent.click(view.getByRole('button', { name: translate('switchToApi', { provider: CLAUDE }) }))
    const resetAt = vi.mocked(props.switchBilling).mock.calls[0]?.[3]
    expect(resetAt).toBeGreaterThanOrEqual(NOW + 86_400_000)
    expect(resetAt).toBeLessThanOrEqual(Date.now() + 86_400_000)
  })

  it('Not now dismisses the prompt by its window key', () => {
    const { props, view } = renderPrompt([claude({ monthly: { usedPercent: 95, resetAt: RESET } }, subscription)])
    fireEvent.click(view.getByRole('button', { name: en.notNow }))
    expect(props.dismiss).toHaveBeenCalledWith(`limit|anthropic|monthly|${RESET}`)
  })

  it('a provider without a billing switch offers picking another model', () => {
    const { view } = renderPrompt([{ providerId: 'opencode-go', providerName: 'OpenCode Go', configured: true, ok: true, windows: { '5h': { usedPercent: 96, resetAt: RESET } } }])
    expect(view.getByRole('status').textContent).toContain('OpenCode Go is 96% used for the five-hour window (resets ')
    expect(view.getByText(en.pickModel)).toBeDefined()
    expect(view.queryByRole('button', { name: translate('switchToApi', { provider: 'OpenCode Go' }) })).toBeNull()
  })

  it('offers the quiet switch back after the reset and writes the subscription choice', () => {
    const { props, view } = renderPrompt([claude({}, { active: 'api', switch: option })], { switched: { providerId: 'anthropic', resetAt: PAST } })
    expect(view.getByText(translate('promptBack', { provider: CLAUDE }))).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: translate('switchToSubscription', { provider: CLAUDE }) }))
    expect(props.switchBilling).toHaveBeenCalledWith(option, 'subscription', 'anthropic', undefined)
  })

  it('stays hidden below the threshold, while API credits are active, and before a switch resets', () => {
    expect(renderPrompt([claude({ monthly: { usedPercent: 89, resetAt: RESET } }, subscription)]).view.container.textContent).toBe('')
    cleanup()
    expect(renderPrompt([claude({ monthly: { usedPercent: 99, resetAt: RESET } }, { active: 'api', switch: option })]).view.container.textContent).toBe('')
    cleanup()
    expect(renderPrompt([claude({}, { active: 'api', switch: option })], { switched: { providerId: 'anthropic', resetAt: RESET } }).view.container.textContent).toBe('')
  })

  it('uses a configured near-limit share in place of the default 90', () => {
    expect(renderPrompt([claude({ monthly: { usedPercent: 85, resetAt: RESET } }, subscription)], { nearLimitPercent: 80 }).view.getByRole('status')).toBeDefined()
    cleanup()
    expect(renderPrompt([claude({ monthly: { usedPercent: 85, resetAt: RESET } }, subscription)]).view.container.textContent).toBe('')
  })

  it('words a switch for a provider other than Claude with that provider name', () => {
    const { props, view } = renderPrompt([{
      providerId: 'openai-codex', providerName: 'OpenAI Codex', configured: true, ok: true,
      windows: { monthly: { usedPercent: 95, resetAt: RESET } }, billing: { active: 'subscription', switch: option },
    }])
    expect(view.getByRole('status').textContent).toContain('Your OpenAI Codex subscription is 95% used for the monthly window (resets ')
    expect(view.getByRole('status').textContent).not.toContain('Claude')
    fireEvent.click(view.getByRole('button', { name: translate('switchToApi', { provider: 'OpenAI Codex' }) }))
    expect(props.switchBilling).toHaveBeenCalledWith(option, 'api', 'openai-codex', RESET)
  })

  it('offers the switch back for another provider after its window resets, with its name', () => {
    const { props, view } = renderPrompt([{
      providerId: 'openai-codex', providerName: 'OpenAI Codex', configured: true, ok: true, windows: {}, billing: { active: 'api', switch: option },
    }], { switched: { providerId: 'openai-codex', resetAt: PAST } })
    expect(view.getByText('Your OpenAI Codex usage window has reset. Switch back to your OpenAI Codex subscription?')).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: translate('switchToSubscription', { provider: 'OpenAI Codex' }) }))
    expect(props.switchBilling).toHaveBeenCalledWith(option, 'subscription', 'openai-codex', undefined)
  })

  it('refreshes quota once when a running turn ends', () => {
    let running = true
    const refreshValues = vi.fn(async () => {})
    const props = {
      ...promptProps([], { refreshValues }),
      useSession: (select: (value: unknown) => unknown) => select({ running }),
    } as UsageSwitchPromptProps
    const view = render(<UsageSwitchPrompt {...props} />)
    expect(refreshValues).not.toHaveBeenCalled()
    running = false
    view.rerender(<UsageSwitchPrompt {...props} />)
    expect(refreshValues).toHaveBeenCalledOnce()
  })
})
