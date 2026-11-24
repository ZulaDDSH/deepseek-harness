// @vitest-environment jsdom
/** Source Control Host read stores: caching, refresh, missing responses, and current comparisons. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { workspaceDiffUrl, workspaceStatusUrl, type WorkspaceDiff, type WorkspaceStatusValue } from '../src/changes.ts'
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
  it.each([
    ['HTTP failure', () => new Response('offline', { status: 500 })],
    ['invalid status', () => Response.json({ files: [] })],
    ['null status', () => Response.json(null)],
    ['non-record file', () => Response.json({ ...status, files: [null] })],
    ['invalid rename path', () => Response.json({ ...status, files: [{ ...status.files[0], oldPath: 7 }] })],
    ['invalid binary flag', () => Response.json({ ...status, files: [{ ...status.files[0], binary: false }] })],
  ] as const)('retries after %s', async (_label, response) => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(Response.json(status))
    vi.stubGlobal('fetch', fetcher)
    const store = new WorkspaceStatusStore()
    await store.load(workspaceId)
    expect(store.state.getSnapshot()[workspaceStatusUrl(workspaceId)]).toBe('error')
    await store.load(workspaceId)
    expect(store.state.getSnapshot()[workspaceStatusUrl(workspaceId)]).toEqual(status)
    await store.dispose()
  })
  it('caches successful reads, refreshes explicitly, and retains missing responses', async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetcher)
    const store = new WorkspaceStatusStore()
    const url = workspaceStatusUrl(workspaceId)
    fetcher.mockResolvedValueOnce(Response.json(status))
    await store.load(workspaceId)
    expect(store.state.getSnapshot()[url]).toEqual(status)
    await store.load(workspaceId)
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockResolvedValueOnce(Response.json({ ...status, total: 0, files: [] }))
    await store.refresh(workspaceId)
    expect(store.state.getSnapshot()[url]).toMatchObject({ total: 0, files: [] })
    const missing = 'workspace-2' as WorkspaceId
    fetcher.mockResolvedValueOnce(new Response('missing', { status: 404 }))
    await store.load(missing)
    expect(store.state.getSnapshot()[workspaceStatusUrl(missing)]).toBe('missing')
    await store.dispose()
  })
})

describe('WorkspaceDiffStore', () => {
  it('retains missing comparisons and retries invalid comparison data', async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(Response.json({ kind: 'text' }))
      .mockResolvedValueOnce(Response.json(diff))
    vi.stubGlobal('fetch', fetcher)
    const store = new WorkspaceDiffStore()
    await store.load(workspaceId, 'a.ts')
    expect(store.state.getSnapshot()[workspaceDiffUrl(workspaceId, 'a.ts')]).toBe('missing')
    await store.load(workspaceId, 'a.ts')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await store.load(workspaceId, 'b.ts')
    expect(store.state.getSnapshot()[workspaceDiffUrl(workspaceId, 'b.ts')]).toBe('error')
    await store.load(workspaceId, 'b.ts')
    expect(store.state.getSnapshot()[workspaceDiffUrl(workspaceId, 'b.ts')]).toEqual(diff)
    await store.dispose()
  })
  it('forgets only the comparisons of the named workspace and ignores a read that settles after it', async () => {
    const other = 'other-workspace' as WorkspaceId
    let release!: (response: Response) => void
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json(diff))
      .mockResolvedValueOnce(Response.json(diff))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
      .mockResolvedValueOnce(Response.json({ ...diff, display: 'fresh' }))
    vi.stubGlobal('fetch', fetcher)
    const store = new WorkspaceDiffStore()
    await store.load(workspaceId, 'a.ts')
    await store.load(other, 'a.ts')
    store.forget(workspaceId)
    expect(store.state.getSnapshot()[workspaceDiffUrl(workspaceId, 'a.ts')]).toBeUndefined()
    expect(store.state.getSnapshot()[workspaceDiffUrl(other, 'a.ts')]).toEqual(diff)
    const stale = store.load(workspaceId, 'b.ts')
    store.forget(workspaceId)
    await store.load(workspaceId, 'b.ts')
    release(Response.json({ ...diff, display: 'stale' }))
    await stale
    expect(store.state.getSnapshot()[workspaceDiffUrl(workspaceId, 'b.ts')]).toMatchObject({ display: 'fresh' })
    await store.dispose()
  })
  it('reads a comparison once per workspace file and retries a failed response', async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetcher)
    const store = new WorkspaceDiffStore()
    const url = workspaceDiffUrl(workspaceId, 'a.ts')
    fetcher.mockResolvedValueOnce(new Response('offline', { status: 500 }))
    await store.load(workspaceId, 'a.ts')
    expect(store.state.getSnapshot()[url]).toBe('error')
    fetcher.mockResolvedValueOnce(Response.json(diff))
    await store.load(workspaceId, 'a.ts')
    expect(store.state.getSnapshot()[url]).toEqual(diff)
    await store.load(workspaceId, 'a.ts')
    expect(fetcher).toHaveBeenCalledTimes(2)
    await store.dispose()
  })
})
