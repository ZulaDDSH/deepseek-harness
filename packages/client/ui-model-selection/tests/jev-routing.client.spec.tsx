// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelSelection, ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { TurnOutlineEntry } from '@deepseek-ai/dsh-session-turn-outline/types'
import type { JevDecisionRecord } from '@deepseek-ai/dsh-llm-jev-router/client'
import { JevRouting, type JevRoutingProps } from '../src/client/JevRouting.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en, params: Record<string, string> = {}) =>
  en[key].replace(/\{(\w+)\}/g, (_match: string, name: string) => params[name] ?? '')) as JevRoutingProps['t']

const chosen = { provider: 'deepseek', model: 'flash' }
const routedTo = { provider: 'anthropic', model: 'claude-opus-5' }

/** One started turn; `seq` is its own `turn/start` event seq. */
const startedTurn = (turn: number, startSeq: number): TurnOutlineEntry =>
  ({ turn, seq: SessionSeq(startSeq), prompt: '', response: '' })

const FIRST_TURN = [startedTurn(1, 10)]

/** A projection whose recorded request belongs to the open turn. */
const projected = (lastUsed: ModelSelection | null, next: ModelSelection | null): ModelSelectionProjection =>
  ({ lastUsed, lastUsedSeq: lastUsed === null ? null : SessionSeq(12), next })

function mount(
  selection: ModelSelectionProjection | undefined,
  decision: JevDecisionRecord | null | undefined,
  state: { running?: boolean; turns?: readonly TurnOutlineEntry[] } = {},
) {
  const { running = true, turns = FIRST_TURN } = state
  const useProjection = ((key: string) =>
    key === 'jevDecision' ? decision : key === 'turnOutline' ? turns : selection) as JevRoutingProps['useProjection']
  const snapshot = { ...sessionSnapshot('s1' as SessionId), running }
  const useSession: JevRoutingProps['useSession'] = selector => selector(snapshot)
  cleanup()
  return render(<JevRouting t={t} useProjection={useProjection} useSession={useSession} />)
}

const panel = () => screen.getByRole('dialog', { name: en['routing.title'] }).textContent

it('stays hidden before Jev decides while the selected model is the one running', () => {
  mount(projected(chosen, chosen), null)
  mount(undefined, undefined)
  expect(screen.queryByRole('button')).toBeNull()
})

it('names the routed model on the button and explains the decision in a panel', () => {
  mount(projected(routedTo, chosen), { turn: 3, step: 1, choice: 'deep', confidence: 0.92, ...routedTo })
  const button = screen.getByRole('button', { name: 'Jev: claude-opus-5' })
  expect(button.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(button)
  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(panel()).toBe([
    en['routing.running'], 'anthropic / claude-opus-5',
    en['routing.selected'], 'deepseek / flash',
    en['routing.decision'], 'Jev chose deep at 92%; the turn ran anthropic / claude-opus-5.',
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
  mount(projected(chosen, chosen), decision)
  fireEvent.click(screen.getByRole('button', { name: en['routing.button'] }))
  expect(panel()).toContain(text)
})

it('explains a routed run with no decision yet and an unknown selection', () => {
  mount(projected(routedTo, null), null)
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain(en['routing.unknown'])
  expect(panel()).toContain(en['routing.none'])
})

it('says the turn stopped when Jev failed closed instead of keeping the chat model', () => {
  mount(projected(null, chosen), { turn: 1, step: 1, error: 'offline', rejected: true })
  fireEvent.click(screen.getByRole('button', { name: en['routing.button'] }))
  expect(panel()).toContain('The last decision failed, so the turn stopped: offline')
})

it('reports a legacy fallback record without reading its missing route', () => {
  mount(projected(routedTo, chosen), { turn: 1, step: 1, choice: 'small', confidence: 0.01, provider: 'target', model: 'safe' })
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain('Jev chose small at 1%; the turn ran target / safe.')
})

it('reports a legacy record without a route or a pick', () => {
  mount(projected(routedTo, chosen), { turn: 1, step: 1, confidence: 1, ...routedTo })
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain('Jev chose  at 100%; the turn ran anthropic / claude-opus-5.')
})

it('shows nothing known before any request has run', () => {
  mount(projected(null, chosen), { turn: 1, step: 1, error: 'down' })
  fireEvent.click(screen.getByRole('button', { name: en['routing.button'] }))
  expect(panel()).toContain(`${en['routing.running']}${en['routing.unknown']}`)
})

it('says when the fallback route ran because Jev was not confident enough', () => {
  mount(projected(routedTo, chosen), { turn: 1, step: 1, choice: 'flash', confidence: 0.01, route: 'safe', ...routedTo })
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain("Jev wasn't confident enough (best match flash at 1%), so the fallback route safe (anthropic / claude-opus-5) was used.")
})

it("names the applied route when it is Jev's pick", () => {
  mount(projected(routedTo, chosen), { turn: 1, step: 1, choice: 'deep', confidence: 0.9, route: 'deep', ...routedTo })
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain('Jev picked route deep (anthropic / claude-opus-5) with 90% confidence.')
})

it('describes a fallback recorded without a best match', () => {
  mount(projected(routedTo, chosen), { turn: 1, step: 1, confidence: 0, route: 'safe', ...routedTo })
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain('(best match  at 0%), so the fallback route safe')
})

it('renders nothing once the routed turn ends and Jev has no decision', () => {
  mount(projected(routedTo, chosen), null, { running: false })
  expect(screen.queryByRole('button')).toBeNull()
})

it('stops naming a running model once that turn ends', () => {
  mount(projected(routedTo, chosen), { turn: 1, step: 1, choice: 'deep', confidence: 0.9, ...routedTo }, { running: false })
  fireEvent.click(screen.getByRole('button', { name: en['routing.button'] }))
  expect(panel()).toContain(`${en['routing.running']}${en['routing.unknown']}`)
  expect(panel()).toContain(`${en['routing.selected']}deepseek / flash`)
})

it('keeps the routed name off the button until the new turn records its own request', () => {
  const secondTurn = [...FIRST_TURN, startedTurn(2, 30)]
  mount(projected(routedTo, chosen), { turn: 1, step: 1, choice: 'deep', confidence: 0.9, ...routedTo }, { turns: secondTurn })
  expect(screen.getByRole('button', { name: en['routing.button'] })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Jev: claude-opus-5' })).toBeNull()

  mount(projected(routedTo, chosen), null, { turns: secondTurn })
  expect(screen.queryByRole('button')).toBeNull()
})

it('names the model the new turn ran once its own request lands', () => {
  const secondTurn = [...FIRST_TURN, startedTurn(2, 30)]
  mount({ lastUsed: { provider: 'openai', model: 'gpt-5' }, lastUsedSeq: SessionSeq(33), next: chosen }, null, { turns: secondTurn })
  expect(screen.getByRole('button', { name: 'Jev: gpt-5' })).toBeTruthy()
})
