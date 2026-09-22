/** Current repository status and line counts for the Source Control panel. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { WorkspaceFileDiff, WorkspaceStatus, WorkspaceStatusFile } from './types.ts'
import { parseNumstat } from './numstat.ts'
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
  const files: WorkspaceStatusFile[] = []
  for (const record of records) {
    const counts = await countPath(git, root, record.path, signal)
    const absolute = resolve(root, record.path)
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

/** Read the current work-tree text side, bounded after the read. */
async function readWorktree(root: string, path: string, maxBytes: number, signal: AbortSignal): Promise<TextSide> {
  try {
    const bytes = await readFile(resolve(root, path), { signal })
    return bytes.length > maxBytes ? 'oversized' : bytes.toString('utf8')
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT') return null
    throw error
  }
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

/** Count one path against HEAD, including untracked paths through no-index diff. */
async function countPath(git: GitRunner, root: string, path: string, signal: AbortSignal): Promise<Counts> {
  const tracked = await git.run(['diff', '--numstat', '-z', '--no-ext-diff', 'HEAD', '--', path], { cwd: root, signal })
  if (tracked.exitCode === 0 && tracked.stdout !== '') {
    const entry = parseNumstat(tracked.stdout)[0]
    if (entry !== undefined) return { added: entry.added, deleted: entry.deleted, ...entry.binary ? { binary: true } : {} }
  } else if (tracked.exitCode !== 0 && !/does not have any commits yet|bad revision/i.test(tracked.stderr)) {
    throw new Error(`git diff failed: ${tracked.stderr.trim()}`)
  }
  const untracked = await git.run(['diff', '--no-index', '--numstat', '-z', '--no-ext-diff', '--', '/dev/null', path], { cwd: root, signal })
  if (untracked.exitCode !== 0 && untracked.exitCode !== 1) throw new Error(`git diff --no-index failed: ${untracked.stderr.trim()}`)
  if (untracked.stdout === '') return { added: 0, deleted: 0 }
  const entry = parseNumstat(untracked.stdout)[0]
  return entry === undefined
    ? { added: 0, deleted: 0 }
    : { added: entry.added, deleted: entry.deleted, ...entry.binary ? { binary: true } : {} }
}

/** Read the branch without treating detached HEAD as an error. */
async function branch(git: GitRunner, root: string, signal: AbortSignal): Promise<{ branch?: string }> {
  const result = await git.run(['branch', '--show-current'], { cwd: root, signal })
  if (result.exitCode !== 0) throw new Error(`git branch failed: ${result.stderr.trim()}`)
  const value = result.stdout.trim()
  return value === '' ? {} : { branch: value }
}
