/**
 * Per-harness-home anonymous user id shared by telemetry and feedback.
 *
 * The id is a random UUID persisted as a bare line in `.anonymous-user-id` inside the
 * harness home resolved by {@link resolveDshHome} (`$DSH_HOME` > `~/.dsh`),
 * and never derived from the hostname, network address, git remote, or any
 * other identifying source. It is scoped to the harness home, not the
 * machine: every process sharing one `$DSH_HOME` reports the same id, and
 * deleting the file mints a fresh identity on the next launch.
 *
 * Reads and writes are synchronous so boot-time and command consumers can
 * use one API. The result is memoized per resolved file path: one process
 * touches the disk once, and a file deleted mid-run keeps the process's id
 * until the next launch.
 *
 * @module @deepseek-ai/dsh-anonymous-user-id
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, type Stats } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** A harness-home-scoped anonymous user id (random UUID v4). */
export type AnonymousUserId = Branded<'AnonymousUserId'>

/** File inside the harness home storing the id: a bare UUID line, no wrapper format. */
export const ANONYMOUS_USER_ID_FILE_NAME = '.anonymous-user-id'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ambient hooks for locating and generating the id; every field has a default. */
export interface AnonymousUserIdOptions {
  /** Environment consulted for `DSH_HOME`; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** UUID generator; defaults to `crypto.randomUUID` (test hook). */
  randomUUID?: () => string
  /** Longest wait in ms for the creation lock held by another process; defaults to 2000. */
  lockTimeoutMs?: number
  /** Receives each unexpected file-system failure; the id is still returned. Defaults to one stderr line. */
  onFailure?: AnonymousUserIdFailureReporter
}

/**
 * Receives one unexpected file-system failure of the best-effort id persistence.
 * @param message - one line naming the failed step.
 * @param error - the `node:fs` failure, with its `code`, `syscall` and `path`.
 */
export type AnonymousUserIdFailureReporter = (message: string, error: unknown) => void

function reportToStderr(message: string, error: unknown): void {
  process.stderr.write(`${message}: ${String(error)}
`)
}

const ABSENT_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])
const VANISHED_CODES: ReadonlySet<string> = new Set(['ENOENT'])
const NO_CODES: ReadonlySet<string> = new Set()

function surface(report: AnonymousUserIdFailureReporter, step: string, error: unknown, expected: ReadonlySet<string>): void {
  if (expected.has((error as NodeJS.ErrnoException).code ?? '')) return
  report(`dsh-anonymous-user-id: could not ${step}`, error)
}

/** Process-lifetime memo keyed by resolved file path, so distinct test homes never share an id. */
const memo = new Map<string, AnonymousUserId>()

/** Read a valid persisted id from the file, or `undefined` when absent/corrupt. */
function readPersistedId(file: string, report: AnonymousUserIdFailureReporter): AnonymousUserId | undefined {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    surface(report, `read ${file}`, error, ABSENT_CODES)
    return undefined
  }
  const value = text.trim()
  return UUID_PATTERN.test(value) ? (value as AnonymousUserId) : undefined
}

const LOCK_POLL_MS = 10
const LOCK_STALE_MS = 10_000
const DEFAULT_LOCK_TIMEOUT_MS = 2000
const LOCK_CONTENTION_CODES = new Set(['EEXIST', 'EPERM', 'EBUSY'])

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

type LockState = 'held' | 'timeout' | 'unavailable'

function statIfPresent(path: string, report: AnonymousUserIdFailureReporter): Stats | undefined {
  try {
    return statSync(path)
  } catch (error) {
    surface(report, `stat ${path}`, error, VANISHED_CODES)
    return undefined
  }
}

function removeFile(path: string, report: AnonymousUserIdFailureReporter): void {
  try {
    rmSync(path, { force: true })
  } catch (error) {
    surface(report, `remove ${path}`, error, LOCK_CONTENTION_CODES)
  }
}

function removeStaleLock(lockFile: string, seen: Stats, report: AnonymousUserIdFailureReporter): void {
  const again = statIfPresent(lockFile, report)
  if (again?.ino !== seen.ino || again.mtimeMs !== seen.mtimeMs) return
  removeFile(lockFile, report)
}

/** Take the exclusive-create lock file, retrying until `timeoutMs`; a lock older than the stale age is removed. */
function acquireLock(lockFile: string, timeoutMs: number, report: AnonymousUserIdFailureReporter): LockState {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      writeFileSync(lockFile, `${process.pid}\n`, { encoding: 'utf8', flag: 'wx' })
      return 'held'
    } catch (error) {
      if (!LOCK_CONTENTION_CODES.has((error as NodeJS.ErrnoException).code ?? '')) {
        surface(report, `create ${lockFile}`, error, NO_CODES)
        return 'unavailable'
      }
    }
    const seen = statIfPresent(lockFile, report)
    if (seen !== undefined && Date.now() - seen.mtimeMs > LOCK_STALE_MS) removeStaleLock(lockFile, seen, report)
    if (Date.now() >= deadline) return 'timeout'
    sleepSync(LOCK_POLL_MS)
  }
}

/** Under the lock, adopt a valid persisted id or atomically publish `created`; never overwrites unlocked. */
function publishId(file: string, created: AnonymousUserId, timeoutMs: number, report: AnonymousUserIdFailureReporter): AnonymousUserId {
  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch (error) {
    surface(report, `create ${dirname(file)}`, error, NO_CODES)
    return created
  }
  const lockFile = `${file}.lock`
  const state = acquireLock(lockFile, timeoutMs, report)
  if (state === 'unavailable') return created
  try {
    const existing = readPersistedId(file, report)
    if (existing !== undefined || state === 'timeout') return existing ?? created
    const temp = `${file}.${process.pid}.tmp`
    try {
      writeFileSync(temp, `${created}\n`, 'utf8')
      renameSync(temp, file)
    } catch (error) {
      surface(report, `publish ${file}`, error, NO_CODES)
      removeFile(temp, report)
    }
    return created
  } finally {
    if (state === 'held') removeFile(lockFile, report)
  }
}

/** Return the harness home's anonymous user id, minted under a cross-process lock on first use; an unwritable home gives a memory id. */
export function getOrCreateAnonymousUserId(options: AnonymousUserIdOptions = {}): AnonymousUserId {
  const file = join(resolveDshHome(undefined, options.env ?? process.env), ANONYMOUS_USER_ID_FILE_NAME)
  const cached = memo.get(file)
  if (cached !== undefined) return cached

  const report = options.onFailure ?? reportToStderr
  const id = readPersistedId(file, report)
    ?? publishId(file, (options.randomUUID ?? randomUUID)() as AnonymousUserId, options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS, report)
  memo.set(file, id)
  return id
}
