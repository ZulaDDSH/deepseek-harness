// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { JevDecisionRecord } from '@deepseek-ai/dsh-llm-jev-router/client'
import { JevRouting, type JevRoutingProps } from '../src/client/JevRouting.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en, params: Record<string, string> = {}) =>
  en[key].replace(/\{(\w+)\}/g, (_match: string, name: string) => params[name] ?? '')) as JevRoutingProps['t']

const chosen = { provider: 'deepseek', model: 'flash' }
const routedTo = { provider: 'anthropic', model: 'claude-opus-5' }

function mount(selection: ModelSelectionProjection | undefined, decision: JevDecisionRecord | null | undefined) {
  const useProjection = ((key: string) => key === 'jevDecision' ? decision : selection) as JevRoutingProps['useProjection']
  return render(<JevRouting t={t} useProjection={useProjection} />)
}

const panel = () => screen.getByRole('dialog', { name: en['routing.title'] }).textContent

it('stays hidden before Jev decides while the selected model is the one running', () => {
  mount({ lastUsed: chosen, next: chosen }, null)
  mount(undefined, undefined)
  expect(screen.queryByRole('button')).toBeNull()
})

it('names the routed model on the button and explains the decision in a panel', () => {
  mount({ lastUsed: routedTo, next: chosen }, { turn: 3, step: 1, choice: 'deep', confidence: 0.92, ...routedTo })
  const button = screen.getByRole('button', { name: 'Jev: claude-opus-5' })
  expect(button.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(button)
  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(panel()).toBe([
    en['routing.running'], 'anthropic / claude-opus-5',
    en['routing.selected'], 'deepseek / flash',
    en['routing.decision'], 'Sent to route deep (anthropic / claude-opus-5) at 92% confidence.',
  ].join(''))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(button)
  fireEvent.keyDown(button, { key: 'Escape' })
  fireEvent.keyDown(button, { key: 'Enter' })
  fireEvent.click(button)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it.each([
  [{ turn: 1, step: 1, choice: 'keep', confidence: 0.95 }, 'Kept the chat model (95% confidence).'],
  [{ turn: 1, step: 1, confidence: 0.5 }, 'Kept the chat model (50% confidence).'],
  [{ turn: 1, step: 1, choice: 'deep', confidence: 0.61 }, 'Kept the chat model: the best match was deep, but only at 61% confidence.'],
  [{ turn: 1, step: 1, choice: 'deep' }, 'Kept the chat model: the best match was deep, but only at 0% confidence.'],
  [{ turn: 1, step: 1, error: 'timeout' }, 'The last decision failed, so the chat model was kept: timeout'],
  [{ turn: 1, step: 1, choice: 'deep', provider: 'anthropic' }, 'Kept the chat model: the best match was deep, but only at 0% confidence.'],
])('explains a decision that kept the chat model: %o', (decision, text) => {
  mount({ lastUsed: chosen, next: chosen }, decision)
  fireEvent.click(screen.getByRole('button', { name: en['routing.button'] }))
  expect(panel()).toContain(text)
})

it('explains a routed run with no decision yet and an unknown selection', () => {
  mount({ lastUsed: routedTo, next: null }, null)
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain(en['routing.unknown'])
  expect(panel()).toContain(en['routing.none'])
})

it('reports a missing route name as empty', () => {
  mount({ lastUsed: routedTo, next: chosen }, { turn: 1, step: 1, confidence: 1, ...routedTo })
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain('Sent to route  (anthropic / claude-opus-5) at 100% confidence.')
})

it('shows nothing known before any request has run', () => {
  mount({ lastUsed: null, next: chosen }, { turn: 1, step: 1, error: 'down' })
  fireEvent.click(screen.getByRole('button', { name: en['routing.button'] }))
  expect(panel()).toContain(`${en['routing.running']}${en['routing.unknown']}`)
})
