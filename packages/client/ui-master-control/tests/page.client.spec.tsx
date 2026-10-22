// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { MasterControlPage, type MasterControlPageProps } from '../src/client/MasterControlPage.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function summary(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id, displayTitle: id, running: false, retainedBy: {}, blank: false, updatedAt: Date.now(), ...over,
  } as SessionSummary
}

function list(...rows: SessionSummary[]): SessionListState {
  return {
    ids: rows.map(r => r.id),
    byId: Object.fromEntries(rows.map(r => [r.id, r])),
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
  } as unknown as SessionListState
}

function props(over: Partial<MasterControlPageProps> & {
  sessions?: SessionListState
  status?: SessionStatusSnapshot
}): MasterControlPageProps {
  const sessions = over.sessions ?? list()
  const status = over.status ?? new Map() as unknown as SessionStatusSnapshot
  return {
    useSessions: <S,>(selector: (state: SessionListState) => S): S => selector(sessions),
    useSessionStatus: <S,>(selector: (snapshot: SessionStatusSnapshot) => S): S => selector(status),
    open: over.open ?? vi.fn(),
    interrupt: over.interrupt ?? vi.fn(async () => undefined),
    t: makeTranslate(en),
  } as unknown as MasterControlPageProps
}

describe('MasterControlPage', () => {
  it('shows empty copy when ready with no sessions and loading otherwise', () => {
    expect(render(<MasterControlPage {...props()} />).getByText('No sessions yet.')).toBeTruthy()
    cleanup()
    const loading = list()
    ;(loading as { phase: string }).phase = 'loading'
    expect(render(<MasterControlPage {...props({ sessions: loading })} />).getByText('Reading sessions…')).toBeTruthy()
  })

  it('opens a row and interrupts a running turn', async () => {
    const open = vi.fn()
    const interrupt = vi.fn(async () => undefined)
    const sessions = list(
      summary('idle'),
      summary('run', { running: true, displayTitle: 'Running job' }),
    )
    render(<MasterControlPage {...props({ sessions, open, interrupt })} />)
    expect(screen.getByText('Running job')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1]!)
    expect(open).toHaveBeenCalledWith('run')
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    expect(interrupt).toHaveBeenCalledWith('run')
  })

  it('logs when interrupt rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const interrupt = vi.fn(async () => { throw new Error('nope') })
    render(<MasterControlPage {...props({
      sessions: list(summary('run', { running: true })),
      interrupt,
    })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    await vi.waitFor(() => { expect(error).toHaveBeenCalled() })
    error.mockRestore()
  })
})
