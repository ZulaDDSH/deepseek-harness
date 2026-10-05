// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { TurnOutlineEntry } from '@deepseek-ai/dsh-session-turn-outline/types'
import { RoutedModel, type RoutedModelProps } from '../src/client/RoutedModel.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en, params: Record<string, string> = {}) =>
  en[key].replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? '')) as RoutedModelProps['t']

const SELECTED = { provider: 'deepseek', model: 'deepseek-v4.1-flash' }
const ROUTED_B = { provider: 'anthropic', model: 'claude-opus-5' }
const ROUTED_C = { provider: 'openai', model: 'gpt-5' }

/** One started turn; `seq` is its own `turn/start` event seq. */
const startedTurn = (turn: number, startSeq: number): TurnOutlineEntry =>
  ({ turn, seq: SessionSeq(startSeq), prompt: '', response: '' })

function mount(state: {
  selection?: ModelSelectionProjection | undefined
  turns?: readonly TurnOutlineEntry[]
  running?: boolean
}) {
  const { selection, turns = [startedTurn(1, 10)], running = true } = state
  const useProjection = ((key: string) => key === 'turnOutline' ? turns : selection) as RoutedModelProps['useProjection']
  const snapshot = { ...sessionSnapshot('s1' as SessionId), running }
  const useSession: RoutedModelProps['useSession'] = selector => selector(snapshot)
  cleanup()
  return render(<RoutedModel t={t} useProjection={useProjection} useSession={useSession} />)
}

it('shows the model that ran when a router picked another one', () => {
  mount({ selection: { lastUsed: ROUTED_B, next: SELECTED, lastUsedSeq: SessionSeq(12) } })
  const label = screen.getByRole('status')
  expect(label.textContent).toBe('Now: claude-opus-5')
  expect(label.getAttribute('title')).toBe('This turn is running anthropic / claude-opus-5, not the selected model, usually because Jev routed it.')
})

it('stays hidden while the selected model is the one running, or before any request', () => {
  mount({ selection: { lastUsed: SELECTED, next: SELECTED, lastUsedSeq: SessionSeq(12) } })
  mount({ selection: { lastUsed: null, next: SELECTED, lastUsedSeq: null } })
  mount({ selection: undefined })
  expect(screen.queryByRole('status')).toBeNull()
})

it('shows a run on another provider with the same model name', () => {
  mount({ selection: { lastUsed: { provider: 'b', model: 'm' }, next: { provider: 'a', model: 'm' }, lastUsedSeq: SessionSeq(12) } })
  expect(screen.getByRole('status').textContent).toBe('Now: m')
})

it('hides the routed model once the turn that used it has ended', () => {
  mount({ selection: { lastUsed: ROUTED_B, next: SELECTED, lastUsedSeq: SessionSeq(12) }, running: false })
  expect(screen.queryByRole('status')).toBeNull()
})

it('stays hidden when no model is selected, because the projection reports the last run as next', () => {
  const fallback = { provider: 'b', model: 'm' }
  mount({ selection: { lastUsed: fallback, next: fallback, lastUsedSeq: SessionSeq(12) } })
  expect(screen.queryByRole('status')).toBeNull()
})

it('keeps the label hidden through a turn boundary until the new turn records its own request', () => {
  const firstTurn = [startedTurn(1, 10)]
  const secondTurn = [...firstTurn, startedTurn(2, 30)]

  mount({ selection: { lastUsed: ROUTED_B, next: SELECTED, lastUsedSeq: SessionSeq(12) }, turns: firstTurn })
  expect(screen.getByRole('status').textContent).toBe('Now: claude-opus-5')

  mount({ selection: { lastUsed: ROUTED_B, next: SELECTED, lastUsedSeq: SessionSeq(12) }, turns: firstTurn, running: false })
  expect(screen.queryByRole('status')).toBeNull()

  mount({ selection: { lastUsed: ROUTED_B, next: SELECTED, lastUsedSeq: SessionSeq(12) }, turns: secondTurn })
  expect(screen.queryByRole('status')).toBeNull()

  mount({ selection: { lastUsed: ROUTED_C, next: SELECTED, lastUsedSeq: SessionSeq(33) }, turns: secondTurn })
  expect(screen.getByRole('status').textContent).toBe('Now: gpt-5')
})
