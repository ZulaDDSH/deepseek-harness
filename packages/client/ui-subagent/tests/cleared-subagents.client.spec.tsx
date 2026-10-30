// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate, sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { SubagentCatalogAction, type SubagentCatalogActionProps } from '../src/client/SubagentHeaderLineage.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const PARENT = 'parent' as SessionId
const RUNNING = 'running' as SessionId
const DONE = 'done' as SessionId

function props(): SubagentCatalogActionProps {
  const rows = [
    { id: RUNNING, mode: 'continuable' as const, label: 'worker', createdAt: 1 },
    { id: DONE, mode: 'one-shot' as const, label: 'reviewer', createdAt: 1 },
  ]
  const state = {
    ids: [RUNNING, DONE],
    byId: Object.fromEntries(rows.map(row => [row.id, {
      id: row.id, displayTitle: row.label, running: row.id === RUNNING, blank: false, updatedAt: 1, retainedBy: {},
    }])),
    phase: 'ready',
    projectionsBySession: { [PARENT]: { state: 'ready', error: null, values: { subagentCatalog: rows } } },
  } satisfies SessionListState
  const statuses: SessionStatusSnapshot = new Map()
  const snapshot: SessionSnapshot = { ...sessionSnapshot(PARENT), subagent: null }
  const unused = (): never => { throw new Error('not provided by this fixture') }
  return {
    usePanelInfo: unused,
    useSessionRetainInfo: unused,
    useWorkspaces: unused,
    useResource: unused,
    useProjection: unused,
    useAccess: unused,
    useRemoteAccess: unused,
    useSessionAccess: unused,
    useContextMenu: unused,
    useWorkspaceAccess: unused,
    useConversation: unused,
    useInput: unused,
    useChat: unused,
    useTrajectory: unused,
    inputActions: {
      insertQuote: unused, captureInsertion: unused, insertText: unused, setDraft: unused, persistDraft: unused,
      addAttachments: unused, removeAttachment: unused, pruneAttachments: unused, submit: unused,
    },
    sessionId: PARENT,
    useSessions: <T,>(select: (value: SessionListState) => T): T => select(state),
    useSessionStatus: <T,>(select: (value: SessionStatusSnapshot) => T): T => select(statuses),
    useSession: <T,>(select: (value: SessionSnapshot) => T): T => select(snapshot),
    openChild: vi.fn(),
    openChildAside: vi.fn(),
    refreshProjection: vi.fn(),
    t: makeTranslate(en),
  }
}

describe('cleared subagents', () => {
  it('hides finished children, keeps running ones, reveals cleared ones for review, and remembers the choice', () => {
    const input = props()
    render(<SubagentCatalogAction {...input} />)
    fireEvent.click(screen.getByRole('button', { name: /1 subagent running/ }))
    expect(screen.getAllByRole('treeitem')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Clear finished (1)' }))
    expect(screen.getAllByRole('treeitem').map(row => row.getAttribute('aria-label'))).toEqual([expect.stringMatching(/^worker/)])
    expect(screen.getByText('1 subagent')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show cleared (1)' }))
    fireEvent.click(screen.getByRole('treeitem', { name: /reviewer/ }))
    expect(input.openChild).toHaveBeenCalledWith({ parentSessionId: PARENT, childSessionId: DONE, mode: 'one-shot' })

    cleanup()
    render(<SubagentCatalogAction {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: /1 subagent running/ }))
    expect(screen.getAllByRole('treeitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Show cleared (1)' })).toBeTruthy()
  })
})
