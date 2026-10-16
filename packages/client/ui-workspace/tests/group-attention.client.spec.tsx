// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  SessionPendingInteraction, SessionStatus, SessionStatusSnapshot,
} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ProjectRowItem } from '../src/client/rows/Rows.tsx'
import { SessionTree } from '../src/client/rows/SessionTree.tsx'
import { zh } from '../src/client/locales.ts'
import {
  type GroupAttention, type GroupNode, deriveGroups, mergeAttention,
} from '../src/client/tree.ts'

afterEach(cleanup)

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const summary = (id: string, updatedAt: number, running = false): SessionSummary => ({
  id: sid(id), title: id, displayTitle: id, running, blank: false, updatedAt, retainedBy: {},
})
const list = (...items: SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  phase: 'ready', projectionsBySession: {},
})
const workspace = (id: string, sessionIds: string[]): WorkspaceView => ({
  workspaceId: wid(id), path: `/projects/${id}`, title: id,
  sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const view = (expandedGroups: readonly string[] = []) => ({ expandedGroups })
const status = (
  pendingInteraction: SessionPendingInteraction | undefined,
  overrides: Partial<SessionStatus> = {},
): SessionStatus => ({ running: undefined, pendingInteraction, completionUnread: false, ...overrides })
const approval = (id: string): SessionPendingInteraction =>
  ({ key: 'approval:1', kind: 'approval', sessionId: sid(id) }) as SessionPendingInteraction
const rowState = (archived: readonly string[] = [], archivedFilter: 'default' | 'show' = 'default') => ({
  pinnedSessionIds: [] as readonly SessionId[],
  archivedSessionIds: archived.map(sid),
  archivedFilter,
})
const noStatuses: SessionStatusSnapshot = new Map()

/** The zh seat the browser root passes down, matching the row spec. */
const t = makeTranslate(zh, commonZh) as never

describe('deriveGroups folded attention', () => {
  it('folds a pending Session into collapsed group attention and hides its row', () => {
    const statuses: SessionStatusSnapshot = new Map([[sid('awaiting'), status(approval('awaiting'))]])
    const [group] = deriveGroups(
      list(summary('awaiting', 1)), [workspace('project', ['awaiting'])], rowState(), statuses, view(),
    )
    expect(group?.sessions).toEqual([])
    expect(group?.attention).toEqual({ failed: 0, pending: 1, running: 0 })
  })

  it('leaves attention unset for idle groups and ignores archived running Sessions', () => {
    const [idle] = deriveGroups(
      list(summary('idle', 1)), [workspace('idle-project', ['idle'])], rowState(), noStatuses, view(),
    )
    expect(idle?.attention).toBeUndefined()

    const [archived] = deriveGroups(
      list(summary('archived', 2, true)), [workspace('project', ['archived'])],
      rowState(['archived'], 'show'), noStatuses, view(),
    )
    expect(archived?.attention).toBeUndefined()
  })

  it('counts a running Session when nothing folded needs the user', () => {
    const [group] = deriveGroups(
      list(summary('busy', 1, true)), [workspace('project', ['busy'])], rowState(), noStatuses, view(),
    )
    expect(group?.attention).toEqual({ failed: 0, pending: 0, running: 1 })
  })
})

describe('mergeAttention', () => {
  it('sums counts and treats an absent side as identity', () => {
    const a: GroupAttention = { failed: 1, pending: 0, running: 2 }
    const b: GroupAttention = { failed: 0, pending: 3, running: 1 }
    expect(mergeAttention(a, b)).toEqual({ failed: 1, pending: 3, running: 3 })
    expect(mergeAttention(undefined, b)).toBe(b)
    expect(mergeAttention(a, undefined)).toBe(a)
    expect(mergeAttention(undefined, undefined)).toBeUndefined()
  })
})

describe('ProjectRowItem attention dot', () => {
  const renderProject = (attention: GroupAttention | undefined) => {
    const group: GroupNode = {
      key: 'project', workspaceId: wid('project'), cwd: '/projects/project', createdAt: 0, label: 'Project',
      sessionCount: 3, expanded: false, containsCurrent: false, sessions: [],
    }
    return render(<ProjectRowItem group={group} attention={attention} onToggle={vi.fn()} onCreate={vi.fn()} t={t} />)
  }

  it('marks pending attention with a warning dot and a count label', () => {
    renderProject({ failed: 0, pending: 2, running: 1 })
    const dot = screen.getByRole('img', { name: '2 个会话需要处理' })
    expect(dot.querySelector('[data-state="warning"]')).toBeTruthy()
  })

  it('lets a folded failure outrank pending interaction', () => {
    renderProject({ failed: 1, pending: 2, running: 0 })
    const dot = screen.getByRole('img', { name: '3 个会话需要处理' })
    expect(dot.querySelector('[data-state="error"]')).toBeTruthy()
  })

  it('renders no dot without attention', () => {
    renderProject(undefined)
    expect(screen.queryByRole('img', { name: /个会话/ })).toBeNull()
  })
})

describe('SessionTree folded subtree attention', () => {
  it('rolls a collapsed child Workspace attention into its collapsed parent row', () => {
    const statuses: SessionStatusSnapshot = new Map([[sid('awaiting'), status(approval('awaiting'))]])
    const parent: WorkspaceView = {
      workspaceId: wid('parent'), path: '/projects/parent', title: 'parent', sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const child: WorkspaceView = {
      workspaceId: wid('child'), path: '/projects/parent/child', title: 'child', sessionIds: [sid('awaiting')],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const props: Parameters<typeof SessionTree>[0] = {
      list: list(summary('awaiting', 1)), workspaces: [parent, child], shortcuts: [],
      appearanceByWorkspace: {}, appearanceBySession: {}, ungroupedSessionIds: [], rowState: rowState(),
      workspaceReady: true, animationResetKey: 'tree', nestWorkspaces: true, groupExpansion: { parent: false },
      usePanelInfo: selector => selector({ activePanelId: null }),
      useSessionStatus: selector => selector(statuses),
      renderSlot: () => null, startSession: vi.fn(), open: vi.fn(), insertWorkspaceBefore: vi.fn(async () => {}),
      setGroupExpanded: vi.fn(), setSessionOrder: vi.fn(), onLeaveArchivedOnly: vi.fn(),
      onRenameRequest: vi.fn(), onDeleteRequest: vi.fn(), onAppearanceRequest: vi.fn(), onAppearanceChange: vi.fn(),
      onSessionAppearanceChange: vi.fn(), onSessionRenameRequest: vi.fn(), sections: [], assignSession: vi.fn(),
      onChatDragStart: vi.fn(), onChatDragEnd: vi.fn(), onSessionRevealed: vi.fn(), t,
    }
    render(<SessionTree {...props} />)
    expect(screen.queryByText('awaiting')).toBeNull()
    expect(screen.getByRole('img', { name: '1 个会话需要处理' })).toBeTruthy()
  })
})
