/** Repository status and current working-tree comparison behavior. */
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { resolveRepositoryRoot } from '../src/git.ts'
import * as WorkspaceChanges from '../src/index.ts'
import { readWorkspaceDiff, readWorkspaceStatus } from '../src/status.ts'
import { git, runner, scratchDir } from './support.ts'

// These tests spawn real git children and can exceed the default budget under load.
vi.setConfig({ testTimeout: 30_000 })

const cleanups: Array<() => Promise<unknown>> = []
const signal = new AbortController().signal

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('current workspace status', () => {
  it('reports modified, deleted, added, and renamed files with line counts', async () => {
    const root = await scratchDir('dsh-status-', cleanups)
    git(root, 'init', '-q', '-b', 'main')
    await writeFile(join(root, 'changed.txt'), 'one\ntwo\n')
    await writeFile(join(root, 'removed.txt'), 'old\n')
    await writeFile(join(root, 'renamed.txt'), 'rename\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'base')
    await writeFile(join(root, 'changed.txt'), 'one\ntwo\nthree\n')
    await unlink(join(root, 'removed.txt'))
    git(root, 'mv', 'renamed.txt', 'moved.txt')
    await writeFile(join(root, 'new.txt'), 'new\n')

    const { ctx, git: command } = await runner()
    cleanups.push(() => ctx.fiber.dispose())
    const repositoryRoot = await resolveRepositoryRoot(command, root, signal)
    expect(repositoryRoot).not.toBeNull()
    const status = await readWorkspaceStatus(command, repositoryRoot!, root, 20, signal)

    expect(status.branch).toBe('main')
    expect(status.total).toBe(4)
    expect(status.files.map(file => file.path)).toEqual(['changed.txt', 'moved.txt', 'new.txt', 'removed.txt'])
    expect(status.files.find(file => file.path === 'changed.txt')).toMatchObject({ index: ' ', worktree: 'M', added: 1, deleted: 0 })
    expect(status.files.find(file => file.path === 'new.txt')).toMatchObject({ index: '?', worktree: '?', added: 1, deleted: 0 })
    expect(status.files.find(file => file.path === 'removed.txt')).toMatchObject({ index: ' ', worktree: 'D', added: 0, deleted: 1 })
    expect(status.files.find(file => file.path === 'moved.txt')).toMatchObject({ oldPath: 'renamed.txt' })
    expect(status.added).toBe(3)
    expect(status.deleted).toBe(1)
  })

  it('compares the selected status entry against HEAD and handles deleted files', async () => {
    const root = await scratchDir('dsh-diff-', cleanups)
    git(root, 'init', '-q', '-b', 'main')
    await writeFile(join(root, 'changed.txt'), 'before\n')
    await writeFile(join(root, 'removed.txt'), 'gone\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'base')
    await writeFile(join(root, 'changed.txt'), 'after\n')
    await unlink(join(root, 'removed.txt'))

    const { ctx, git: command } = await runner()
    cleanups.push(() => ctx.fiber.dispose())
    const repositoryRoot = await resolveRepositoryRoot(command, root, signal)
    expect(repositoryRoot).not.toBeNull()
    const status = await readWorkspaceStatus(command, repositoryRoot!, root, 20, signal)
    const changed = status.files.find(file => file.path === 'changed.txt')!
    const removed = status.files.find(file => file.path === 'removed.txt')!
    const changedDiff = await readWorkspaceDiff(command, repositoryRoot!, changed, 1024, 1000, signal)
    const removedDiff = await readWorkspaceDiff(command, repositoryRoot!, removed, 1024, 1000, signal)

    expect(changedDiff).toMatchObject({ kind: 'text', path: 'changed.txt', before: true, after: true })
    expect(changedDiff.kind === 'text' && changedDiff.hunks.flatMap(hunk => hunk.lines)).toEqual(expect.arrayContaining(['-before', '+after']))
    expect(removedDiff).toMatchObject({ kind: 'text', path: 'removed.txt', before: true, after: false })
  })
})

describe('workspaceChanges service registry access', () => {
  it('resolves the workspace registry on each request, not when the plugin applies', async () => {
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(SessionStore)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(WorkspaceChanges, {
      timeoutMs: 30_000, outputMaxBytes: 1024 * 1024, maxFiles: 20, maxFileBytes: 1024 * 1024, diffTimeoutMs: 1000,
      root: await scratchDir('dsh-status-store-', cleanups),
      retentionSessions: 200, retentionBytes: 512 * 1024 * 1024, retentionDays: 30,
    })
    // The shipped composition can activate this plugin while the registry's own
    // asynchronous initialization is still running, so the registry is only
    // provided here, after apply returned.
    const asked: string[] = []
    const workspaceId = 'workspace-under-test' as WorkspaceId
    ctx.provide('workspaceRegistry', {
      get: (id: string) => { asked.push(id); return undefined },
    } as never)

    expect(await ctx.workspaceChanges.status(workspaceId, signal)).toBeUndefined()
    expect(asked).toEqual([workspaceId])
    expect(await ctx.workspaceChanges.workspaceDiff(workspaceId, 0, signal)).toBeUndefined()
    expect(asked).toEqual([workspaceId, workspaceId])
  })
})
