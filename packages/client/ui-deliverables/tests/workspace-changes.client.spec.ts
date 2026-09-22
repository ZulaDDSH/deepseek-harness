// @vitest-environment jsdom
/** Source Control Host read stores: caching, refresh, missing responses, and current comparisons. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { workspaceStatusUrl, type WorkspaceDiff, type WorkspaceStatusValue } from '../src/changes.ts'
import { WorkspaceDiffStore } from '../src/client/workspace-diff.ts'
import { WorkspaceStatusStore } from '../src/client/workspace-status.ts'

const workspaceId = 'workspace-1' as WorkspaceId
const status: WorkspaceStatusValue = {
  workspaceId,
  branch: 'main',
  files: [{ path: 'src/app.ts', display: 'src/app.ts', index: ' ', worktree: 'M', added: 1, deleted: 0 }],
  total: 1,
  added: 1,
  deleted: 0,
}
const diff: WorkspaceDiff = {
  kind: 'text', path: 'src/app.ts', display: 'src/app.ts', before: true, after: true, coarse: false,
  hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }],
}

afterEach(() => { vi.unstubAllGlobals() })

describe('WorkspaceStatusStore', () => {
  it('caches successful reads, refreshes explicitly, and retains missing responses', async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetcher)
    const store = new WorkspaceStatusStore()
    const url = workspaceStatusUrl(workspaceId)
    expect(store.generationOf(workspaceId)).toBe(0)
    fetcher.mockResolvedValueOnce(Response.json(status))
    await store.load(workspaceId)
    expect(store.state.getSnapshot()[url]).toEqual(status)
    await store.load(workspaceId)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(store.generationOf(workspaceId)).toBe(0)
    fetcher.mockResolvedValueOnce(Response.json({ ...status, total: 0, files: [] }))
    await store.refresh(workspaceId)
    expect(store.state.getSnapshot()[url]).toMatchObject({ total: 0, files: [] })
    expect(store.generationOf(workspaceId)).toBe(1)
    const missing = 'workspace-2' as WorkspaceId
    fetcher.mockResolvedValueOnce(new Response('missing', { status: 404 }))
    await store.load(missing)
    expect(store.state.getSnapshot()[workspaceStatusUrl(missing)]).toBe('missing')
    await store.dispose()
  })

  it('forgets the generations with the states a replaced connection invalidated', async () => {
    const store = new WorkspaceStatusStore()
    await store.refresh(workspaceId)
    expect(store.generationOf(workspaceId)).toBe(1)
    store.reset()
    expect(store.generationOf(workspaceId)).toBe(0)
    await store.dispose()
  })
})

describe('WorkspaceDiffStore', () => {
  it('reads a comparison once per workspace file and retries a failed response', async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetcher)
    const store = new WorkspaceDiffStore()
    const url = WorkspaceDiffStore.keyOf(workspaceId, 'src/app.ts', 0, 0)
    fetcher.mockResolvedValueOnce(new Response('offline', { status: 500 }))
    await store.load(workspaceId, 'src/app.ts', 0, 0)
    expect(store.state.getSnapshot()[url]).toBe('error')
    fetcher.mockResolvedValueOnce(Response.json(diff))
    await store.load(workspaceId, 'src/app.ts', 0, 0)
    expect(store.state.getSnapshot()[url]).toEqual(diff)
    await store.load(workspaceId, 'src/app.ts', 0, 0)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await store.dispose()
  })

  it('reads a comparison again for a status generation that replaced the list', async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetcher)
    const store = new WorkspaceDiffStore()
    fetcher.mockImplementation(() => Promise.resolve(Response.json(diff)))
    await store.load(workspaceId, 'src/app.ts', 0, 0)
    await store.load(workspaceId, 'src/app.ts', 1, 0)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(store.state.getSnapshot()[WorkspaceDiffStore.keyOf(workspaceId, 'src/app.ts', 1, 0)]).toEqual(diff)
    await store.dispose()
  })
})
