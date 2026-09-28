/** Live comparisons preserve Git symlink content and bound filesystem reads. */
import { lstat, open, readFile, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
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
  const { ctx, git: command } = await runner()
  cleanups.push(() => ctx.fiber.dispose())
  const bytes = Buffer.from('0123456789')
  const stat = { isSymbolicLink: () => false, isFile: () => true, dev: 1, ino: 2 }
  vi.mocked(lstat).mockResolvedValueOnce(stat as Awaited<ReturnType<typeof lstat>>)
  vi.mocked(readFile).mockResolvedValueOnce(bytes)
  let consumed = 0
  const read = vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
    const bytesRead = bytes.copy(buffer, offset, position, Math.min(position + length, position + 2))
    consumed += bytesRead
    return { bytesRead, buffer }
  })
  const close = vi.fn(async () => {})
  vi.mocked(open).mockResolvedValueOnce({ read, close, stat: async () => stat } as unknown as Awaited<ReturnType<typeof open>>)
  const file = { path: 'large', display: 'large', index: '?', worktree: '?', added: 1, deleted: 0 }
  expect(await readWorkspaceDiff(command, '/repo', file, 4, 1000, signal)).toMatchObject({ kind: 'oversized' })
  expect(consumed).toBe(5)
  expect(close).toHaveBeenCalledOnce()
  expect(readFile).not.toHaveBeenCalled()
})

it.each(['device', 'inode', 'directory', 'read failure', 'cancellation'])('closes the handle after %s without following a replaced entry', async (failure) => {
  const { ctx, git: command } = await runner()
  cleanups.push(() => ctx.fiber.dispose())
  const controller = new AbortController()
  const stat = { isSymbolicLink: () => false, isFile: () => true, dev: 1, ino: 2 }
  vi.mocked(lstat).mockResolvedValueOnce(stat as Awaited<ReturnType<typeof lstat>>)
  const read = vi.fn(async () => { throw new Error('read failed') })
  const close = vi.fn(async () => {})
  const opened = { ...stat, dev: failure === 'device' ? 3 : 1, ino: failure === 'inode' ? 3 : 2, isFile: () => failure !== 'directory' }
  vi.mocked(open).mockResolvedValueOnce({
    read, close, stat: async () => {
      if (failure === 'cancellation') controller.abort(new Error('cancelled'))
      return opened
    },
  } as unknown as Awaited<ReturnType<typeof open>>)
  const file = { path: 'file', display: 'file', index: '?', worktree: '?', added: 1, deleted: 0 }
  await expect(readWorkspaceDiff(command, '/repo', file, 4, 1000, controller.signal)).rejects.toThrow(
    failure === 'read failure' ? 'read failed' : failure === 'cancellation' ? 'cancelled' : 'worktree entry changed or is not a regular file',
  )
  expect(close).toHaveBeenCalledOnce()
  if (failure !== 'read failure') expect(read).not.toHaveBeenCalled()
})

it.each(['', 'abcd', 'abcde', 'éé', 'ééé'])('applies the inclusive byte limit to %j', async (content) => {
  const root = await scratchDir('dsh-status-limit-', cleanups)
  const { ctx, git: command } = await runner()
  cleanups.push(() => ctx.fiber.dispose())
  await writeFile(join(root, 'file'), content)
  const file = { path: 'file', display: 'file', index: '?', worktree: '?', added: 1, deleted: 0 }
  const diff = await readWorkspaceDiff(command, root, file, 4, 1000, signal)
  expect(diff.kind).toBe(Buffer.byteLength(content) > 4 ? 'oversized' : 'text')
  if (content !== '' && diff.kind === 'text') expect(diff.hunks.flatMap(hunk => hunk.lines)).toEqual([`+${content}`])
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
