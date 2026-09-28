// @vitest-environment jsdom
/** Source Control panel presentation: workspace selection, status counts, file selection, and refresh. */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { workspaceDiffUrl, workspaceStatusUrl, type WorkspaceDiff, type WorkspaceStatusValue } from '../src/changes.ts'
import { SourceChangesPage, type SourceChangesPageProps } from '../src/client/SourceChangesPage.tsx'
import { WorkspaceChangesTab, type WorkspaceChangesTabProps } from '../src/client/WorkspaceChangesTab.tsx'
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

function fixture() {
  const statuses = new WorkspaceStatusStore()
  const diffs = new WorkspaceDiffStore()
  let workspaces = [{ workspaceId, path: '/work', title: 'Project', sessionIds: [], createdAt: '', updatedAt: '' }]
  const sessionId = SessionId('unretained')
  const sessions: SessionListState = { ids: [sessionId], phase: 'ready', projectionsBySession: {}, byId: {
    [sessionId]: { id: sessionId, displayTitle: 'Background', cwd: '/work', retainedBy: {}, running: false, blank: false, updatedAt: 1 },
  } }
  const loadStatus = vi.fn<WorkspaceStatusStore['load']>(() => Promise.resolve())
  const refreshStatus = vi.fn<WorkspaceStatusStore['refresh']>(() => Promise.resolve())
  const loadDiff = vi.fn<WorkspaceDiffStore['load']>(() => Promise.resolve())
  const props = {
    useWorkspaces: <S,>(selector: (state: { items: typeof workspaces }) => S): S => selector({ items: workspaces }),
    useSessions: <S,>(selector: (state: SessionListState) => S): S => selector(sessions),
    useWorkspaceStatus: hookOf(statuses.state), useWorkspaceDiff: hookOf(diffs.state),
    loadStatus, refreshStatus, loadDiff, t: makeTranslate(en),
  } as SourceChangesPageProps
  return { statuses, diffs, workspaces, props, loadStatus, refreshStatus, loadDiff,
    setWorkspaces: (items: typeof workspaces) => { workspaces = items },
  }
}

describe.each(['main', 'sidebar'] as const)('Source Control %s surface', (surface) => {
  const Page = (props: SourceChangesPageProps) => surface === 'main'
    ? <SourceChangesPage {...props} /> : <WorkspaceChangesTab {...props as WorkspaceChangesTabProps} sessionId={SessionId('unretained')} />
  it('loads a workspace that arrives after the empty workspace list', () => {
    const f = fixture()
    const saved = f.workspaces.splice(0)
    saved.push({ workspaceId: 'workspace-2' as WorkspaceId, path: '/other', title: 'Other', sessionIds: [], createdAt: '', updatedAt: '' })
    const view = render(<Page {...f.props} />)
    expect(view.getByText(en['source.noWorkspace'])).toBeTruthy()
    expect(f.loadStatus).not.toHaveBeenCalled()
    f.setWorkspaces(saved)
    view.rerender(<Page {...f.props} />)
    expect(f.loadStatus).toHaveBeenCalledWith(workspaceId)
  })

  it.each(['loading', 'error', 'missing'] as const)('presents %s status and allows error retry', (state) => {
    const f = fixture()
    f.statuses.state.set({ [workspaceStatusUrl(workspaceId)]: state })
    const view = render(<Page {...f.props} />)
    expect(view.getByText(en[state === 'missing' ? 'source.noRepository' : state === 'error' ? 'source.error' : 'source.loading'])).toBeTruthy()
    if (state === 'error') {
      fireEvent.click(view.getByRole('button', { name: en['presented.retry'] }))
      expect(f.refreshStatus).toHaveBeenCalledWith(workspaceId)
    }
  })

  it.each(['loading', 'missing', 'error', 'binary', 'oversized'] as const)('presents a %s comparison', (state) => {
    const f = fixture()
    f.statuses.state.set({ [workspaceStatusUrl(workspaceId)]: status })
    f.diffs.state.set({ [workspaceDiffUrl(workspaceId, 0)]: state === 'binary' || state === 'oversized'
      ? { kind: state, path: 'src/app.ts', display: 'src/app.ts' } : state })
    const view = render(<Page {...f.props} />)
    expect(view.getByText(en[`diff.${state}`])).toBeTruthy()
    if (state === 'error') {
      fireEvent.click(view.getByRole('button', { name: en['presented.retry'] }))
      expect(f.loadDiff).toHaveBeenCalledWith(workspaceId, 0)
    }
  })

  it('selects files and workspaces, then resets a removed file selection', () => {
    const f = fixture()
    const second = 'workspace-2' as WorkspaceId
    f.workspaces.push({ workspaceId: second, title: 'Other', path: '/other', sessionIds: [], createdAt: '', updatedAt: '' })
    const files: WorkspaceStatusValue['files'] = [
      ...status.files,
      { path: 'image.png', display: 'image.png', index: 'A', worktree: ' ', added: 0, deleted: 0, binary: true },
      { path: 'clean.ts', display: 'clean.ts', index: ' ', worktree: ' ', added: 0, deleted: 0 },
    ]
    const { branch: _branch, ...withoutBranch } = status
    f.statuses.state.set({ [workspaceStatusUrl(workspaceId)]: { ...withoutBranch, files } })
    const view = render(<Page {...f.props} />)
    expect(view.getByText('A')).toBeTruthy()
    expect(view.getAllByText('M')).toHaveLength(2)
    fireEvent.click(view.getByText('image.png'))
    expect(f.loadDiff).toHaveBeenLastCalledWith(workspaceId, 2)
    act(() => { f.statuses.state.set({ [workspaceStatusUrl(workspaceId)]: { ...status, files: [] } }) })
    expect(view.getByText(en['source.clean'])).toBeTruthy()
    expect(view.getByText(en['source.selectFile'])).toBeTruthy()
    fireEvent.change(view.getByRole('combobox'), { target: { value: second } })
    expect(f.loadStatus).toHaveBeenCalledWith(second)
  })
})

describe('SourceChangesPage', () => {
  it('renders current counts and selected file comparison, then refreshes the workspace', () => {
    const statuses = new WorkspaceStatusStore()
    const diffs = new WorkspaceDiffStore()
    statuses.state.set({ [workspaceStatusUrl(workspaceId)]: status })
    diffs.state.set({ [workspaceDiffUrl(workspaceId, 0)]: diff })
    const refreshStatus = vi.fn<WorkspaceStatusStore['refresh']>(() => Promise.resolve())
    const loadStatus = vi.fn<WorkspaceStatusStore['load']>(() => Promise.resolve())
    const loadDiff = vi.fn<WorkspaceDiffStore['load']>(() => Promise.resolve())
    const workspaces = [{ workspaceId, path: '/work', title: 'Project', sessionIds: [], createdAt: '', updatedAt: '' }]
    const sessions: SessionListState = {
      ids: [SessionId('session')], phase: 'ready', projectionsBySession: {},
      byId: { [SessionId('session')]: {
        id: SessionId('session'), displayTitle: 'session', cwd: '/work', retainedBy: { mainView: 1 },
        running: false, blank: false, updatedAt: 1,
      } },
    }
    const props = {
      useWorkspaces: <S,>(selector: (state: { items: typeof workspaces }) => S): S => selector({ items: workspaces }),
      useSessions: <S,>(selector: (state: SessionListState) => S): S => selector(sessions),
      useWorkspaceStatus: hookOf(statuses.state),
      useWorkspaceDiff: hookOf(diffs.state),
      loadStatus, refreshStatus, loadDiff,
      t: makeTranslate(en),
    } as SourceChangesPageProps

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
