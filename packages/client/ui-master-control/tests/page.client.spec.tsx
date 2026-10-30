// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    projectionsBySession: {},
  }
}

function props(over: Partial<MasterControlPageProps> & {
  sessions?: SessionListState
  status?: SessionStatusSnapshot
} = {}): MasterControlPageProps {
  const sessions = over.sessions ?? list()
  const status = over.status ?? new Map()
  return {
    useSessions: <S,>(selector: (state: SessionListState) => S): S => selector(sessions),
    useSessionStatus: <S,>(selector: (snapshot: SessionStatusSnapshot) => S): S => selector(status),
    discover: over.discover ?? vi.fn(async () => ({ items: [], limited: false })),
    importChats: over.importChats ?? vi.fn(async () => ({ items: [] })),
    useWorkspaces: over.useWorkspaces ?? ((selector: (state: { items: never[] }) => unknown) => selector({ items: [] })),
    open: over.open ?? vi.fn(),
    interrupt: over.interrupt ?? vi.fn(async () => undefined),
    t: makeTranslate(en),
  } as MasterControlPageProps
}

describe('MasterControlPage', () => {
  it('moves seven-day idle chats into the accessible Archive menu', async () => {
    render(<MasterControlPage {...props({ sessions: list(
      summary('old', { displayTitle: 'Archived history', updatedAt: Date.now() - 8 * 86_400_000 }),
      summary('fresh', { displayTitle: 'Current work' }),
    ) })} />)
    expect(screen.queryByText('Archived history')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Archive (1)' }))
    expect(screen.getByText('Archived history')).toBeTruthy()
    expect(screen.queryByText('Current work')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Active chats' }))
    expect(screen.getByText('Current work')).toBeTruthy()
  })
  it('filters the roster by title or cwd and live state, and hides the home', () => {
    render(<MasterControlPage {...props({ sessions: list(
      summary('master-control-home-example'),
      summary('a', { displayTitle: 'Build client', cwd: 'D:/Alpha', running: true }),
      summary('b', { displayTitle: 'Review server', cwd: 'D:/Beta' }),
    ) })} />)
    expect(screen.queryByText('master-control-home-example')).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search title or folder' }), { target: { value: 'beta' } })
    expect(screen.getByText('Review server')).toBeTruthy()
    expect(screen.queryByText('Build client')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Running' }))
    expect(screen.getByText('No matching sessions.')).toBeTruthy()
  })

  it('previews selected imports, reports per-row failures, and opens an imported chat', async () => {
    const open = vi.fn()
    const importChats = vi.fn(async () => ({ items: [{ key: 'good' as never, sessionId: 'imported-one' as never }, { key: 'bad' as never, error: 'File changed' }] }))
    render(<MasterControlPage {...props({ open, importChats, discover: async () => ({ limited: true, items: [
      { key: 'good' as never, source: 'codex', title: 'My chat', updatedAt: 1, messageCount: 2, preview: 'user: Earlier prompt' },
      { key: 'bad' as never, source: 'claude', title: 'Other chat', updatedAt: 1, messageCount: 1, preview: 'user: Other' },
    ] }) })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Import chats…' }))
    await screen.findByRole('checkbox', { name: 'codex: My chat' })
    expect(screen.getByText('user: Earlier prompt')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'codex: My chat' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'claude: Other chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import selected' }))
    await screen.findByText('Other chat: File changed')
    expect(importChats).toHaveBeenCalledWith(['good', 'bad'])
    const imported = screen.getByText('My chat: Imported')
    fireEvent.click(within(imported).getByRole('button', { name: 'Open' }))
    expect(open).toHaveBeenCalledWith('imported-one')
  })

  it('shows empty copy when ready with no sessions and loading otherwise', () => {
    expect(render(<MasterControlPage {...props()} />).getByText('No sessions yet.')).toBeTruthy()
    cleanup()
    const loading = list()
    ;(loading as { phase: string }).phase = 'loading'
    expect(render(<MasterControlPage {...props({ sessions: loading })} />).getByText('Reading sessions…')).toBeTruthy()
  })

  it('opens a worker row and interrupts a running turn', async () => {
    const open = vi.fn()
    const interrupt = vi.fn(async () => undefined)
    const sessions = list(
      summary('idle'),
      summary('run', { running: true, displayTitle: 'Running job', updatedAt: Date.now() + 1 }),
    )
    render(<MasterControlPage {...props({ sessions, open, interrupt })} />)
    expect(screen.getByText('Running job')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]!)
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

  it('collapses and expands workspace cards and supports expand/collapse all', () => {
    const sessions = list(
      summary('a', { displayTitle: 'Session Alpha', cwd: 'D:/Alpha' }),
      summary('b', { displayTitle: 'Session Beta', cwd: 'D:/Beta' }),
    )
    const workspaces = {
      items: [
        { workspaceId: 'w1', title: 'Alpha', path: 'D:/Alpha', sessionIds: ['a'] },
        { workspaceId: 'w2', title: 'Beta', path: 'D:/Beta', sessionIds: ['b'] },
      ],
    }
    render(<MasterControlPage {...props({
      sessions,
      useWorkspaces: selector => selector(workspaces as never),
    })} />)
    expect(screen.getByText('Session Alpha')).toBeTruthy()
    expect(screen.getByText('Session Beta')).toBeTruthy()

    // Collapse All
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('Session Alpha')).toBeNull()
    expect(screen.queryByText('Session Beta')).toBeNull()

    // Expand All
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText('Session Alpha')).toBeTruthy()
    expect(screen.getByText('Session Beta')).toBeTruthy()

    // Toggle specific workspace
    const alphaHeader = screen.getByRole('button', { name: /Alpha/ })
    fireEvent.click(alphaHeader)
    expect(screen.queryByText('Session Alpha')).toBeNull()
    expect(screen.getByText('Session Beta')).toBeTruthy()
  })

  it('refreshes discovery on open and on a timer without importing chats', async () => {
    vi.useFakeTimers()
    try {
      const discover = vi.fn(async () => ({ limited: false, items: [
        { key: 'chat-1' as never, source: 'codex' as const, title: 'Discovered chat', updatedAt: 1, messageCount: 1, preview: 'user: hi' },
      ] }))
      const importChats = vi.fn(async () => ({ items: [] }))
      render(<MasterControlPage {...props({ discover, importChats })} />)
      await act(async () => { await Promise.resolve() })
      expect(discover).toHaveBeenCalledTimes(1)
      expect(importChats).not.toHaveBeenCalled()
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
      expect(discover).toHaveBeenCalledTimes(2)
      expect(importChats).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
