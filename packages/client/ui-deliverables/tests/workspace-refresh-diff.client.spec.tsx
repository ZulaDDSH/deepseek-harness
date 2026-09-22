// @vitest-environment jsdom
/**
 * A status refresh reorders the file list while an earlier comparison stays
 * cached at the index it was read for. The review must show the comparison of
 * the file now listed at the index, never the previous file's comparison.
 */
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
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
const sessionId = 'session-1' as SessionId

function hookOf<T>(source: { subscribe: (listener: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(selector: (value: T) => S): S {
    return selector(useSyncExternalStore(source.subscribe, source.getSnapshot))
  }
}

function statusOf(paths: readonly string[]): WorkspaceStatusValue {
  return {
    workspaceId, branch: 'main', total: paths.length, added: paths.length, deleted: 0,
    files: paths.map(path => ({ path, display: path, index: ' ', worktree: 'M', added: 1, deleted: 0 })),
  }
}

function diffOf(path: string): WorkspaceDiff {
  return {
    kind: 'text', path, display: path, before: true, after: true, coarse: false,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [`-${path}`, `+${path}`] }],
  }
}

afterEach(() => { cleanup() })

describe('workspace status refresh against a cached comparison', () => {
  it('shows the comparison of the file now at the index after the status list reorders', async () => {
    const statuses = new WorkspaceStatusStore()
    const diffs = new WorkspaceDiffStore()
    statuses.state.set({ [workspaceStatusUrl(workspaceId)]: statusOf(['src/a.ts', 'src/b.ts']) })

    // The Host answers the comparison route by the file the client asks about.
    const requested: string[] = []
    const pathsAtRequest: string[] = []
    let current = ['src/a.ts', 'src/b.ts']
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
      const params = new URL(url, 'http://localhost').searchParams
      if (url.includes('workspace.diff')) {
        const path = current[Number(params.get('index'))] as string
        requested.push(path)
        pathsAtRequest.push(url)
        return Promise.resolve(Response.json(diffOf(path)))
      }
      return Promise.resolve(Response.json(statusOf(current)))
    }))

    const workspaces = [{ workspaceId, path: '/work', title: 'Project', sessionIds: [], createdAt: '', updatedAt: '' }]
    const sessions = { byId: { [sessionId]: { cwd: '/work' } } } as unknown as SessionListState
    const props = {
      sessionId,
      useWorkspaces: <S,>(selector: (state: { items: typeof workspaces }) => S): S => selector({ items: workspaces }),
      useSessions: <S,>(selector: (state: SessionListState) => S): S => selector(sessions),
      useWorkspaceStatus: hookOf(statuses.state),
      useWorkspaceDiff: hookOf(diffs.state),
      loadStatus: (target: WorkspaceId) => statuses.load(target),
      refreshStatus: (target: WorkspaceId) => statuses.refresh(target),
      loadDiff: (target: WorkspaceId, position: number) => diffs.load(target, position),
      t: makeTranslate(en),
    } as unknown as WorkspaceChangesTabProps

    const view = render(<WorkspaceChangesTab {...props} />)
    // The first render reads index 0, which is src/a.ts.
    await waitFor(() => { expect(view.container.textContent).toContain('-src/a.ts') })
    expect(requested).toEqual(['src/a.ts'])

    // The working tree changed: refresh now lists src/b.ts first, so index 0
    // names a different file than the comparison already cached there.
    current = ['src/b.ts', 'src/c.ts']
    fireEvent.click(view.getByRole('button', { name: 'Refresh changes' }))

    await waitFor(() => { expect(view.container.textContent).toContain('src/b.ts') })
    // The comparison drawn beside src/b.ts must be src/b.ts's own.
    await waitFor(() => { expect(view.container.textContent).toContain('-src/b.ts') })
    expect(view.container.textContent).not.toContain('-src/a.ts')

    vi.unstubAllGlobals()
    void statuses.dispose()
    void diffs.dispose()
  })
})
