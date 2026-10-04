// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import { RoutedModel, type RoutedModelProps } from '../src/client/RoutedModel.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en, params: Record<string, string> = {}) =>
  en[key].replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? '')) as RoutedModelProps['t']

function mount(selection: ModelSelectionProjection | undefined) {
  const useProjection = (() => selection) as RoutedModelProps['useProjection']
  return render(<RoutedModel t={t} useProjection={useProjection} />)
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

it('shows the run when nothing is selected yet but a model already ran', () => {
  mount({ lastUsed: { provider: 'b', model: 'm' }, next: null })
  expect(screen.getByRole('status').textContent).toBe('Now: m')
})
