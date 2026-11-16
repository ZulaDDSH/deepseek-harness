/** Current repository status and line counts for the Source Control panel. */
import { constants } from 'node:fs'
import { lstat, open, readlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { WorkspaceFileDiff, WorkspaceStatus, WorkspaceStatusFile } from './types.ts'
import { parseNumstat, type NumstatEntry } from './numstat.ts'
import { compareText } from './compare.ts'
import { displayPathOf, compareDisplay } from './paths.ts'
import type { GitRunner } from './git.ts'

/**
 * Read the current work-tree status without changing the repository index.
 * @param git - bounded git runner.
 * @param root - repository top-level directory.
 * @param cwd - canonical Session working directory.
 * @param maxFiles - maximum files returned to the client.
 * @param signal - cancellation signal.
 * @returns current repository status.
 */
export async function readWorkspaceStatus(
  git: GitRunner,
  root: string,
  cwd: string,
  maxFiles: number,
  signal: AbortSignal,
): Promise<WorkspaceStatus> {
  const status = await git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, signal })
  if (status.exitCode !== 0) throw new Error(`git status failed: ${status.stderr.trim()}`)
  const records = parseStatus(status.stdout)
  const tracked = await git.run(['diff', '--numstat', '-z', '--no-ext-diff', '--no-renames', 'HEAD'], { cwd: root, signal })
  if (tracked.exitCode !== 0 && !/does not have any commits yet|bad revision|unknown revision/i.test(tracked.stderr)) {
    throw new Error(`git diff failed: ${tracked.stderr.trim()}`)
  }
  const trackedCounts = new Map((tracked.stdout === '' ? [] : parseNumstat(tracked.stdout)).map(entry => [entry.path, entry]))
  const files: WorkspaceStatusFile[] = []
  for (const record of records) {
    const absolute = await worktreePath(root, record.path)
    const counts = trackedCounts.get(record.path) ?? await countPath(git, root, record.path, signal)
    files.push({
      path: record.path,
      display: displayPathOf(absolute, cwd, root, ''),
      index: record.index,
      worktree: record.worktree,
      ...(record.oldPath === undefined ? {} : { oldPath: record.oldPath }),
      added: counts.added,
      deleted: counts.deleted,
      ...(counts.binary === true ? { binary: true as const } : {}),
    })
  }
  files.sort(compareDisplay)
  return {
    cwd,
    root,
    ...await branch(git, root, signal),
    files: files.slice(0, maxFiles),
    total: files.length,
    added: files.reduce((sum, file) => sum + file.added, 0),
    deleted: files.reduce((sum, file) => sum + file.deleted, 0),
  }
}

/**
 * Compare one current status entry with its HEAD version.
 * @param git - bounded git runner.
 * @param root - repository top-level directory.
 * @param file - status entry selected by the client.
 * @param maxFileBytes - maximum side size retained for comparison.
 * @param diffTimeoutMs - line comparison deadline.
 * @param signal - cancellation signal.
 * @returns a structured comparison.
 */
export async function readWorkspaceDiff(
  git: GitRunner,
  root: string,
  file: WorkspaceStatusFile,
  maxFileBytes: number,
  diffTimeoutMs: number,
  signal: AbortSignal,
): Promise<WorkspaceFileDiff> {
  if (file.binary === true) return { kind: 'binary', path: file.path, display: file.display }
  const beforePath = file.oldPath ?? file.path
  const before = file.index === '?' || file.index === 'A' ? null : await readHead(git, root, beforePath, maxFileBytes, signal)
  const after = file.worktree === 'D' || file.index === 'D' ? null : await readWorktree(root, file.path, maxFileBytes, signal)
  if (before === 'oversized' || after === 'oversized') return { kind: 'oversized', path: file.path, display: file.display }
  const comparison = compareText(before, after, diffTimeoutMs)
  return {
    kind: 'text', path: file.path, display: file.display,
    before: before !== null, after: after !== null,
    hunks: comparison.hunks, coarse: comparison.coarse,
  }
}

type TextSide = string | null

/** Read a committed text side, or null when the path has no HEAD version. */
async function readHead(git: GitRunner, root: string, path: string, maxBytes: number, signal: AbortSignal): Promise<TextSide> {
  const result = await git.run(['show', `HEAD:${path}`], { cwd: root, maxBytes, signal })
  if (result.exitCode !== 0) return null
  if (result.truncated) return 'oversized'
  return result.stdout
}

/** Read symlink targets as Git blobs and regular work-tree text. */
async function readWorktree(root: string, path: string, maxBytes: number, signal: AbortSignal): Promise<TextSide> {
  try {
    signal.throwIfAborted()
    const absolute = await worktreePath(root, path)
    const stat = await lstat(absolute)
    let bytes: Buffer
    if (stat.isSymbolicLink()) {
      bytes = await readlink(absolute, { encoding: 'buffer' })
    } else {
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const opened = await handle.stat()
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
          throw new Error(`worktree entry changed or is not a regular file: ${path}`)
        }
        const probe = Buffer.allocUnsafe(maxBytes + 1)
        let length = 0
        while (length < probe.length) {
          signal.throwIfAborted()
          const { bytesRead } = await handle.read(probe, length, probe.length - length, length)
          if (bytesRead === 0) break
          length += bytesRead
        }
        bytes = probe.subarray(0, length)
      } finally {
        await handle.close()
      }
    }
    return bytes.length > maxBytes ? 'oversized' : bytes.toString('utf8')
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT') return null
    throw error
  }
}
/** Resolve a repository entry without traversing symlinked parent directories. */
async function worktreePath(root: string, path: string): Promise<string> {
  const absolute = resolve(root, path)
  const rel = relative(root, absolute)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`worktree path is outside repository: ${path}`)
  let parent = root
  for (const component of rel.split(sep).slice(0, -1)) {
    parent = join(parent, component)
    try {
      const stat = await lstat(parent)
      if (stat.isSymbolicLink()) throw new Error(`worktree path traverses a symlinked directory: ${path}`)
      if (!stat.isDirectory()) throw new Error(`worktree parent is not a directory: ${path}`)
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT') return absolute
      throw error
    }
  }
  return absolute
}

interface StatusRecord {
  index: string
  worktree: string
  path: string
  oldPath?: string
}

/** Parse NUL-delimited porcelain v1 status records. */
function parseStatus(output: string): StatusRecord[] {
  const fields = output.split('\0')
  if (fields.at(-1) !== '') throw new Error('git status output is not NUL-terminated')
  fields.pop()
  const records: StatusRecord[] = []
  while (fields.length > 0) {
    const record = fields.shift() as string
    if (record.length < 4 || record[2] !== ' ') throw new Error(`malformed git status record: ${record}`)
    const item: StatusRecord = { index: record[0] as string, worktree: record[1] as string, path: record.slice(3) }
    if (item.index === 'R' || item.index === 'C' || item.worktree === 'R' || item.worktree === 'C') {
      const oldPath = fields.shift()
      if (oldPath === undefined) throw new Error('malformed git status rename record')
      item.oldPath = oldPath
    }
    records.push(item)
  }
  return records
}

interface Counts { added: number; deleted: number; binary?: true }

/** Count a path absent from the tracked numstat response through no-index diff. */
async function countPath(git: GitRunner, root: string, path: string, signal: AbortSignal): Promise<Counts> {
  const untracked = await git.run(['diff', '--no-index', '--numstat', '-z', '--no-ext-diff', '--', '/dev/null', path], { cwd: root, signal })
  if (untracked.exitCode !== 0 && untracked.exitCode !== 1) throw new Error(`git diff --no-index failed: ${untracked.stderr.trim()}`)
  if (untracked.stdout === '') return { added: 0, deleted: 0 }
  const entry = parseNumstat(untracked.stdout)[0] as NumstatEntry
  return { added: entry.added, deleted: entry.deleted, ...entry.binary ? { binary: true } : {} }
}

/** Read the branch without treating detached HEAD as an error. */
async function branch(git: GitRunner, root: string, signal: AbortSignal): Promise<{ branch?: string }> {
  const result = await git.run(['branch', '--show-current'], { cwd: root, signal })
  if (result.exitCode !== 0) throw new Error(`git branch failed: ${result.stderr.trim()}`)
  const value = result.stdout.trim()
  return value === '' ? {} : { branch: value }
}
