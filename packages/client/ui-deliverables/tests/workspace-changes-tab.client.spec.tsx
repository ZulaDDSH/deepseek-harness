// @vitest-environment jsdom
/** Workspace review tab presentation: session Workspace selection, counts, file selection, and comparison. */
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { workspaceStatusUrl, type WorkspaceDiff, type WorkspaceStatusValue } from '../src/changes.ts'
import { WorkspaceChangesTab, type WorkspaceChangesTabProps } from '../src/client/WorkspaceChangesTab.tsx'
import { WorkspaceDiffStore } from '../src/client/workspace-diff.ts'
import { WorkspaceStatusStore } from '../src/client/workspace-status.ts'
import { en } from '../src/client/locales.ts'

const workspaceId = 'workspace-1' as WorkspaceId
const otherId = 'workspace-2' as WorkspaceId
const sessionId = 'session-1' as SessionId
const status: WorkspaceStatusValue = {
  workspaceId, branch: 'main', total: 2, added: 3, deleted: 1,
  files: [
    { path: 'src/app.ts', display: 'src/app.ts', index: ' ', worktree: 'M', added: 2, deleted: 1 },
    { path: 'notes.md', display: 'notes.md', index: '?', worktree: '?', added: 1, deleted: 0 },
  ],
}
const diff: WorkspaceDiff = {
  kind: 'text', path: 'src/app.ts', display: 'src/app.ts', before: true, after: true, coarse: false,
  hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }],
}

function hookOf<T>(source: { subscribe: (listener: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(selector: (value: T) => S): S {
    return selector(useSyncExternalStore(source.subscribe, source.getSnapshot))
  }
}

afterEach(() => { cleanup() })

describe('WorkspaceChangesTab', () => {
  it('shows the session workspace counts, selects a file, and renders its comparison', () => {
    const statuses = new WorkspaceStatusStore()
    const diffs = new WorkspaceDiffStore()
    statuses.state.set({ [workspaceStatusUrl(workspaceId)]: status })
    diffs.state.set({ [WorkspaceDiffStore.keyOf(workspaceId, 'src/app.ts', 0, 0)]: diff })
    const refreshStatus = vi.fn<WorkspaceStatusStore['refresh']>(() => Promise.resolve())
    const loadStatus = vi.fn<WorkspaceStatusStore['load']>(() => Promise.resolve())
    const loadDiff = vi.fn<WorkspaceDiffStore['load']>(() => Promise.resolve())
    const workspaces = [{ workspaceId, path: '/work', title: 'Project', sessionIds: [], createdAt: '', updatedAt: '' }]
    const sessions = { byId: { [sessionId]: { cwd: '/work' } } } as unknown as SessionListState
    const props = {
      sessionId,
      useWorkspaces: <S,>(selector: (state: { items: typeof workspaces }) => S): S => selector({ items: workspaces }),
      useSessions: <S,>(selector: (state: SessionListState) => S): S => selector(sessions),
      useWorkspaceStatus: hookOf(statuses.state),
      useWorkspaceDiff: hookOf(diffs.state),
      loadStatus, refreshStatus, loadDiff,
      statusGenerationOf: (target: WorkspaceId) => statuses.generationOf(target),
      t: makeTranslate(en),
    } as unknown as WorkspaceChangesTabProps

    const view = render(<WorkspaceChangesTab {...props} />)
    expect(view.getByText('Changed: 2')).toBeTruthy()
    expect(view.getByText('main')).toBeTruthy()
    expect(view.getByText('src/app.ts')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-diff-line]')).toHaveLength(2)
    fireEvent.click(view.getByRole('button', { name: 'Refresh changes' }))
    expect(refreshStatus).toHaveBeenCalledWith(workspaceId)
    expect(loadStatus).not.toHaveBeenCalled()
    expect(loadDiff).not.toHaveBeenCalled()
    void statuses.dispose()
    void diffs.dispose()
  })

  it('resolves the workspace whose path matches the session cwd, not the first listed', () => {
    const statuses = new WorkspaceStatusStore()
    const diffs = new WorkspaceDiffStore()
    const loadStatus = vi.fn<WorkspaceStatusStore['load']>(() => Promise.resolve())
    const workspaces = [
      { workspaceId: otherId, path: '/elsewhere', title: 'Other', sessionIds: [], createdAt: '', updatedAt: '' },
      { workspaceId, path: '/work', title: 'Project', sessionIds: [], createdAt: '', updatedAt: '' },
    ]
    const sessions = { byId: { [sessionId]: { cwd: '/work' } } } as unknown as SessionListState
    const props = {
      sessionId,
      useWorkspaces: <S,>(selector: (state: { items: typeof workspaces }) => S): S => selector({ items: workspaces }),
      useSessions: <S,>(selector: (state: SessionListState) => S): S => selector(sessions),
      useWorkspaceStatus: hookOf(statuses.state),
      useWorkspaceDiff: hookOf(diffs.state),
      loadStatus,
      refreshStatus: vi.fn<WorkspaceStatusStore['refresh']>(() => Promise.resolve()),
      loadDiff: vi.fn<WorkspaceDiffStore['load']>(() => Promise.resolve()),
      statusGenerationOf: (target: WorkspaceId) => statuses.generationOf(target),
      t: makeTranslate(en),
    } as unknown as WorkspaceChangesTabProps

    render(<WorkspaceChangesTab {...props} />)
    expect(loadStatus).toHaveBeenCalledWith(workspaceId)
    void statuses.dispose()
    void diffs.dispose()
  })

  it('offers a workspace picker only when more than one workspace exists', () => {
    const statuses = new WorkspaceStatusStore()
    const diffs = new WorkspaceDiffStore()
    const single = [{ workspaceId, path: '/work', title: 'Project', sessionIds: [], createdAt: '', updatedAt: '' }]
    const sessions = { byId: { [sessionId]: { cwd: '/work' } } } as unknown as SessionListState
    const base = {
      sessionId,
      useSessions: <S,>(selector: (state: SessionListState) => S): S => selector(sessions),
      useWorkspaceStatus: hookOf(statuses.state),
      useWorkspaceDiff: hookOf(diffs.state),
      loadStatus: vi.fn<WorkspaceStatusStore['load']>(() => Promise.resolve()),
      refreshStatus: vi.fn<WorkspaceStatusStore['refresh']>(() => Promise.resolve()),
      loadDiff: vi.fn<WorkspaceDiffStore['load']>(() => Promise.resolve()),
      statusGenerationOf: (target: WorkspaceId) => statuses.generationOf(target),
      t: makeTranslate(en),
    }
    const singleProps = { ...base,
      useWorkspaces: <S,>(s: (state: { items: typeof single }) => S): S => s({ items: single }),
    } as unknown as WorkspaceChangesTabProps
    const view = render(<WorkspaceChangesTab {...singleProps} />)
    expect(view.queryByLabelText('Workspace')).toBeNull()
    view.unmount()

    const many = [...single, {
      workspaceId: otherId, path: '/elsewhere', title: 'Other', sessionIds: [], createdAt: '', updatedAt: '',
    }]
    const manyProps = { ...base,
      useWorkspaces: <S,>(s: (state: { items: typeof many }) => S): S => s({ items: many }),
    } as unknown as WorkspaceChangesTabProps
    const second = render(<WorkspaceChangesTab {...manyProps} />)
    expect(second.getByLabelText('Workspace')).toBeTruthy()
    void statuses.dispose()
    void diffs.dispose()
  })
})
