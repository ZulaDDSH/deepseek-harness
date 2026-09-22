// @vitest-environment jsdom
/** Source Control panel presentation: workspace selection, status counts, file selection, and refresh. */
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { workspaceStatusUrl, type WorkspaceDiff, type WorkspaceStatusValue } from '../src/changes.ts'
import { SourceChangesPage, type SourceChangesPageProps } from '../src/client/SourceChangesPage.tsx'
import { WorkspaceDiffStore } from '../src/client/workspace-diff.ts'
import { WorkspaceStatusStore } from '../src/client/workspace-status.ts'
import { en } from '../src/client/locales.ts'

const workspaceId = 'workspace-1' as WorkspaceId
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

describe('SourceChangesPage', () => {
  it('renders current counts and selected file comparison, then refreshes the workspace', () => {
    const statuses = new WorkspaceStatusStore()
    const diffs = new WorkspaceDiffStore()
    statuses.state.set({ [workspaceStatusUrl(workspaceId)]: status })
    diffs.state.set({ [WorkspaceDiffStore.keyOf(workspaceId, 'src/app.ts', 0, 0)]: diff })
    const refreshStatus = vi.fn<WorkspaceStatusStore['refresh']>(() => Promise.resolve())
    const loadStatus = vi.fn<WorkspaceStatusStore['load']>(() => Promise.resolve())
    const loadDiff = vi.fn<WorkspaceDiffStore['load']>(() => Promise.resolve())
    const workspaces = [{ workspaceId, path: '/work', title: 'Project', sessionIds: [], createdAt: '', updatedAt: '' }]
    const sessions = { byId: { session: { cwd: '/work', retainedBy: { mainView: 1 } } } } as unknown as SessionListState
    const props = {
      useWorkspaces: <S,>(selector: (state: { items: typeof workspaces }) => S): S => selector({ items: workspaces }),
      useSessions: <S,>(selector: (state: SessionListState) => S): S => selector(sessions),
      useWorkspaceStatus: hookOf(statuses.state),
      useWorkspaceDiff: hookOf(diffs.state),
      loadStatus, refreshStatus, loadDiff,
      statusGenerationOf: (target: WorkspaceId) => statuses.generationOf(target),
      t: makeTranslate(en),
    } as unknown as SourceChangesPageProps

    const view = render(<SourceChangesPage {...props} />)
    expect(view.getByRole('heading', { name: 'Changes' })).toBeTruthy()
    expect(view.getAllByText('Changed: 2')).toHaveLength(2)
    expect(view.getByText('+3')).toBeTruthy()
    expect(view.getAllByText('-1')).toHaveLength(2)
    expect(view.getByText('src/app.ts')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-diff-line]')).toHaveLength(2)
    fireEvent.click(view.getByRole('button', { name: 'Refresh changes' }))
    expect(refreshStatus).toHaveBeenCalledWith(workspaceId)
    expect(loadStatus).not.toHaveBeenCalled()
    expect(loadDiff).not.toHaveBeenCalled()
    void statuses.dispose()
    void diffs.dispose()
  })
})
