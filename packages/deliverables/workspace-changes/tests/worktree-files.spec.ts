/** Live comparisons preserve Git symlink content and bound filesystem reads. */
import { lstat, mkdir, open, readFile, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { readWorkspaceDiff, readWorkspaceStatus } from '../src/status.ts'
import { git, runner, scratchDir } from './support.ts'

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, lstat: vi.fn(fs.lstat), open: vi.fn(fs.open), readlink: vi.fn(fs.readlink), readFile: vi.fn(fs.readFile) }
})

const cleanups: Array<() => Promise<unknown>> = []
const signal = new AbortController().signal

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('compares a symlink target without reading its destination', async () => {
  const { ctx, git: command } = await runner()
  cleanups.push(() => ctx.fiber.dispose())
  vi.mocked(lstat).mockResolvedValueOnce({ isSymbolicLink: () => true } as Awaited<ReturnType<typeof lstat>>)
  vi.mocked(readlink).mockResolvedValueOnce(Buffer.from('../outside-secret.txt'))
  vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('private destination contents'))
  const file = { path: 'link', display: 'link', index: '?', worktree: '?', added: 1, deleted: 0 }
  const diff = await readWorkspaceDiff(command, '/repo', file, 1024, 1000, signal)
  expect(diff.kind === 'text' && diff.hunks.flatMap(hunk => hunk.lines)).toEqual(['+../outside-secret.txt'])
  expect(readFile).not.toHaveBeenCalled()
})

it('reads at most maxFileBytes plus one byte before reporting oversized', async () => {
  const root = await scratchDir('dsh-status-read-', cleanups)
  const { ctx, git: command } = await runner()
  cleanups.push(() => ctx.fiber.dispose())
  const bytes = Buffer.from('0123456789')
  await writeFile(join(root, 'large'), bytes)
  const handle = await open(join(root, 'large'), 'r')
  cleanups.push(() => handle.close())
  const read = vi.spyOn(handle, 'read')
  const close = vi.spyOn(handle, 'close')
  vi.mocked(open).mockResolvedValueOnce(handle)
  vi.mocked(readFile).mockResolvedValueOnce(bytes)
  const file = { path: 'large', display: 'large', index: '?', worktree: '?', added: 1, deleted: 0 }
  expect(await readWorkspaceDiff(command, root, file, 4, 1000, signal)).toMatchObject({ kind: 'oversized' })
  const reads = await Promise.all(read.mock.results.flatMap(result => result.type === 'return' ? [result.value] : []))
  expect(reads.reduce((sum, result) => sum + result.bytesRead, 0)).toBe(5)
  expect(close).toHaveBeenCalledOnce()
  expect(readFile).not.toHaveBeenCalled()
})

it.each(['device', 'inode', 'directory', 'read failure', 'cancellation'])('closes the handle after %s without following a replaced entry', async (failure) => {
  const root = await scratchDir('dsh-status-error-', cleanups)
  const { ctx, git: command } = await runner()
  cleanups.push(() => ctx.fiber.dispose())
  const controller = new AbortController()
  await writeFile(join(root, 'file'), 'text')
  const handle = await open(join(root, 'file'), 'r')
  cleanups.push(() => handle.close())
  const opened = await handle.stat()
  if (failure === 'device') opened.dev += 1
  if (failure === 'inode') opened.ino += 1
  if (failure === 'directory') vi.spyOn(opened, 'isFile').mockReturnValue(false)
  vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
    if (failure === 'cancellation') controller.abort(new Error('cancelled'))
    return opened
  })
  const read = vi.spyOn(handle, 'read').mockRejectedValueOnce(new Error('read failed'))
  const close = vi.spyOn(handle, 'close')
  vi.mocked(open).mockResolvedValueOnce(handle)
  const file = { path: 'file', display: 'file', index: '?', worktree: '?', added: 1, deleted: 0 }
  await expect(readWorkspaceDiff(command, root, file, 4, 1000, controller.signal)).rejects.toThrow(
    failure === 'read failure' ? 'read failed' : failure === 'cancellation' ? 'cancelled' : 'worktree entry changed or is not a regular file',
  )
  expect(close).toHaveBeenCalledOnce()
  if (failure !== 'read failure') expect(read).not.toHaveBeenCalled()
})

it.each(['', 'abcd', 'abcde', 'éé', 'ééé'])('applies the inclusive byte limit to %j', async (content) => {
  const root = await scratchDir('dsh-status-limit-', cleanups)
  const { ctx, git: command } = await runner()
  cleanups.push(() => ctx.fiber.dispose())
  await mkdir(join(root, '..notes'))
  await writeFile(join(root, '..notes', 'file'), content)
  const file = { path: '..notes/file', display: '..notes/file', index: '?', worktree: '?', added: 1, deleted: 0 }
  const diff = await readWorkspaceDiff(command, root, file, 4, 1000, signal)
  expect(diff.kind).toBe(Buffer.byteLength(content) > 4 ? 'oversized' : 'text')
  if (content !== '' && diff.kind === 'text') expect(diff.hunks.flatMap(hunk => hunk.lines)).toEqual([`+${content}`])
})

it.each(['../outside', '..', 'parent/file', 'missing/file'])('rejects escapes and non-directory parents, and preserves missing entries (%s)', async (path) => {
  const root = await scratchDir('dsh-status-parent-', cleanups)
  const { ctx, git: command } = await runner()
  cleanups.push(() => ctx.fiber.dispose())
  await writeFile(join(root, 'parent'), 'text')
  const file = { path, display: path, index: '?', worktree: '?', added: 1, deleted: 0 }
  if (path === 'missing/file') {
    expect(await readWorkspaceDiff(command, root, file, 1024, 1000, signal)).toMatchObject({ kind: 'text', after: false })
  } else {
    await expect(readWorkspaceDiff(command, root, file, 1024, 1000, signal)).rejects.toThrow(
      path === 'parent/file' ? 'worktree parent is not a directory' : 'worktree path is outside repository',
    )
  }
})

it('rejects a file below a directory symlink or Windows junction', async () => {
  const directory = await scratchDir('dsh-status-directory-link-', cleanups)
  const root = join(directory, 'repo')
  const outside = join(directory, 'outside')
  await mkdir(root)
  await mkdir(outside)
  git(root, 'init', '-q', '-b', 'main')
  await writeFile(join(outside, 'secret.txt'), 'private destination contents')
  await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  const { ctx, git: command } = await runner()
  cleanups.push(() => ctx.fiber.dispose())
  const file = { path: 'link/secret.txt', display: 'link/secret.txt', index: '?', worktree: '?', added: 1, deleted: 0 }
  await expect(readWorkspaceDiff(command, root, file, 1024, 1000, signal)).rejects.toThrow(/symlinked directory/)
  if (process.platform === 'win32') {
    await expect(readWorkspaceStatus(command, root, root, 20, signal)).rejects.toThrow(/symlinked directory/)
  }
})

it.for([false, true])('never discloses an external symlink destination (tracked=%s)', async (tracked, context) => {
  const directory = await scratchDir('dsh-status-links-', cleanups)
  const root = join(directory, 'repo')
  git(directory, 'init', '-q', '-b', 'main', root)
  const secret = 'private destination contents\nsecond line\n'
  await writeFile(join(directory, 'outside-secret.txt'), secret)
  const link = join(root, 'link')
  try {
    await symlink('../previous-target.txt', link, 'file')
  } catch (error: unknown) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
      context.skip('Windows requires file-symlink creation privileges')
    }
    throw error
  }
  if (tracked) {
    git(root, '-c', 'core.symlinks=true', 'add', 'link')
    git(root, 'commit', '-q', '-m', 'base')
  }
  await unlink(link)
  await symlink('../outside-secret.txt', link, 'file')
  const { ctx, git: command } = await runner()
  cleanups.push(() => ctx.fiber.dispose())
  const status = await readWorkspaceStatus(command, root, root, 20, signal)
  const file = status.files.find(entry => entry.path === 'link')!
  const diff = await readWorkspaceDiff(command, root, file, 1024, 1000, signal)
  expect(diff.kind === 'text' && diff.hunks.flatMap(hunk => hunk.lines)).toEqual(
    tracked ? ['-../previous-target.txt', '+../outside-secret.txt'] : ['+../outside-secret.txt'],
  )
  expect(JSON.stringify(diff)).not.toContain('private destination contents')
})
