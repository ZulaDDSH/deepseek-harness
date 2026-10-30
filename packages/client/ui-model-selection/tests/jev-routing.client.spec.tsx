// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelSelection, ModelSelectionProjection } from '@deepseek-ai/dsh-agent/types'
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
    en['routing.intro'],
    en['routing.running'], 'anthropic / claude-opus-5',
    en['routing.selected'], 'deepseek / flash',
    en['routing.decision'], 'Jev chose deep (92% sure); this message ran on anthropic / claude-opus-5.',
    en['routing.off'],
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
  [{ turn: 1, step: 1, choice: 'keep', confidence: 0.95 }, 'Jev kept your picked model (95% sure).'],
  [{ turn: 1, step: 1, confidence: 0.5 }, 'Jev kept your picked model (50% sure).'],
  [{ turn: 1, step: 1, choice: 'deep', confidence: 0.61 }, 'Jev kept your picked model: its best match was deep, but it was only 61% sure.'],
  [{ turn: 1, step: 1, choice: 'deep' }, 'Jev kept your picked model: its best match was deep, but it was only 0% sure.'],
  [{ turn: 1, step: 1, choice: 'deep', provider: 'anthropic' }, 'Jev kept your picked model: its best match was deep, but it was only 0% sure.'],
])('explains a decision that kept the picked model: %o', (decision, text) => {
  mount(projected(chosen, chosen), decision)
  fireEvent.click(screen.getByRole('button', { name: en['routing.button'] }))
  expect(panel()).toContain(text)
})

it.each([
  [{ turn: 1, step: 1, error: 'timeout' }, "Jev couldn't decide (timeout). This older record doesn't say whether the turn went on."],
  [{ turn: 1, step: 1, error: 'timeout', rejected: false }, "Jev couldn't decide (timeout), so your picked model was used."],
  [{ turn: 1, step: 1, error: 'timeout', rejected: true }, "Jev couldn't decide (timeout), so the turn was stopped."],
])('explains a failed decision without assuming a model ran: %o', (decision, text) => {
  mount(projected(null, chosen), decision)
  fireEvent.click(screen.getByRole('button', { name: en['routing.button'] }))
  expect(panel()).toContain(text)
})

it('explains a routed run with no decision yet and an unknown selection', () => {
  mount(projected(routedTo, null), null)
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain(en['routing.unknown'])
  expect(panel()).toContain(en['routing.none'])
})

it('reports a legacy fallback record without reading its missing route', () => {
  mount(projected(routedTo, chosen), { turn: 1, step: 1, choice: 'small', confidence: 0.01, provider: 'target', model: 'safe' })
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain('Jev chose small (1% sure); this message ran on target / safe.')
})

it('reports a legacy record without a route or a pick', () => {
  mount(projected(routedTo, chosen), { turn: 1, step: 1, confidence: 1, ...routedTo })
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain("Jev's pick wasn't recorded (100% sure); this message ran on anthropic / claude-opus-5.")
})

it('shows nothing known before any request has run', () => {
  mount(projected(null, chosen), { turn: 1, step: 1, error: 'down' })
  fireEvent.click(screen.getByRole('button', { name: en['routing.button'] }))
  expect(panel()).toContain(`${en['routing.running']}${en['routing.unknown']}`)
})

it('says when the fallback route ran because Jev was not confident enough', () => {
  mount(projected(routedTo, chosen), { turn: 1, step: 1, choice: 'flash', confidence: 0.01, route: 'safe', ...routedTo })
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain("Jev wasn't sure enough (best match flash, 1% sure), so it used the fallback route 'safe' (anthropic / claude-opus-5).")
})

it("names the applied route when it is Jev's pick", () => {
  mount(projected(routedTo, chosen), { turn: 1, step: 1, choice: 'deep', confidence: 0.9, route: 'deep', ...routedTo })
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain("Chose anthropic / claude-opus-5 for this message using the 'deep' route, 90% sure.")
})

it('describes a fallback recorded without a best match', () => {
  mount(projected(routedTo, chosen), { turn: 1, step: 1, confidence: 0, route: 'safe', ...routedTo })
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()).toContain("Jev wasn't sure enough (0% sure), so it used the fallback route 'safe' (anthropic / claude-opus-5).")
})

it('introduces Jev and how to turn it off', () => {
  mount(projected(routedTo, chosen), null)
  fireEvent.click(screen.getByRole('button', { name: 'Jev: claude-opus-5' }))
  expect(panel()?.startsWith('Jev is automatic model routing: for each new message it picks the model best suited to that task.')).toBe(true)
  expect(panel()).toContain('To turn Jev off, go to Settings > AI models > Model routing > Enable Jev routing.')
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
