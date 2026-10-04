// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RoutedModel, type RoutedModelProps } from '../src/client/RoutedModel.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en, params: Record<string, string> = {}) =>
  en[key].replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? '')) as RoutedModelProps['t']

function mount(selection: ModelSelectionProjection | undefined, running = true) {
  const useProjection = (() => selection) as RoutedModelProps['useProjection']
  const snapshot = { ...sessionSnapshot('s1' as SessionId), running }
  const useSession: RoutedModelProps['useSession'] = selector => selector(snapshot)
  return render(<RoutedModel t={t} useProjection={useProjection} useSession={useSession} />)
}

it('shows the model that ran when a router picked another one', () => {
  mount({ lastUsed: { provider: 'anthropic', model: 'claude-opus-5' }, next: { provider: 'deepseek', model: 'deepseek-v4.1-flash' } })
  const label = screen.getByRole('status')
  expect(label.textContent).toBe('Now: claude-opus-5')
  expect(label.getAttribute('title')).toBe('This turn is running anthropic / claude-opus-5, not the selected model, usually because Jev routed it.')
})

it('stays hidden while the selected model is the one running, or before any request', () => {
  mount({ lastUsed: { provider: 'deepseek', model: 'm' }, next: { provider: 'deepseek', model: 'm' } })
  mount({ lastUsed: null, next: { provider: 'deepseek', model: 'm' } })
  mount(undefined)
  expect(screen.queryByRole('status')).toBeNull()
})

it('shows a run on another provider with the same model name', () => {
  mount({ lastUsed: { provider: 'b', model: 'm' }, next: { provider: 'a', model: 'm' } })
  expect(screen.getByRole('status').textContent).toBe('Now: m')
})

it('hides the routed model once the turn that used it has ended', () => {
  mount({ lastUsed: { provider: 'anthropic', model: 'claude-opus-5' }, next: { provider: 'deepseek', model: 'deepseek-v4.1-flash' } }, false)
  expect(screen.queryByRole('status')).toBeNull()
})

it('stays hidden when no model is selected, because the projection reports the last run as next', () => {
  const fallback = { provider: 'b', model: 'm' }
  mount({ lastUsed: fallback, next: fallback })
  expect(screen.queryByRole('status')).toBeNull()
})
