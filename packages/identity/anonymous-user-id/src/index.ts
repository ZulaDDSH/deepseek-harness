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
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
}

/** Process-lifetime memo keyed by resolved file path, so distinct test homes never share an id. */
const memo = new Map<string, AnonymousUserId>()

/** Read a valid persisted id from the file, or `undefined` when absent/corrupt. */
function readPersistedId(file: string): AnonymousUserId | undefined {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    // Absent or unreadable: the caller mints and persists a fresh id.
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

/** Take the exclusive-create lock file, retrying until `timeoutMs`; a lock older than the stale age is removed. */
function acquireLock(lockFile: string, timeoutMs: number): LockState {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      writeFileSync(lockFile, `${process.pid}\n`, { encoding: 'utf8', flag: 'wx' })
      return 'held'
    } catch (error) {
      if (!LOCK_CONTENTION_CODES.has((error as NodeJS.ErrnoException).code ?? '')) return 'unavailable'
    }
    try {
      const seen = statSync(lockFile)
      if (Date.now() - seen.mtimeMs > LOCK_STALE_MS) {
        const again = statSync(lockFile)
        if (again.ino === seen.ino && again.mtimeMs === seen.mtimeMs) rmSync(lockFile, { force: true })
      }
    } catch { /* vanished: retry */ }
    if (Date.now() >= deadline) return 'timeout'
    sleepSync(LOCK_POLL_MS)
  }
}

/** Under the lock, adopt a valid persisted id or atomically publish `created`; never overwrites unlocked. */
function publishId(file: string, created: AnonymousUserId, timeoutMs: number): AnonymousUserId {
  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch {
    return created
  }
  const lockFile = `${file}.lock`
  const state = acquireLock(lockFile, timeoutMs)
  if (state === 'unavailable') return created
  try {
    const existing = readPersistedId(file)
    if (existing !== undefined || state === 'timeout') return existing ?? created
    const temp = `${file}.${process.pid}.tmp`
    try {
      writeFileSync(temp, `${created}\n`, 'utf8')
      renameSync(temp, file)
    } catch {
      rmSync(temp, { force: true })
    }
    return created
  } finally {
    if (state === 'held') rmSync(lockFile, { force: true })
  }
}

/** Return the harness home's anonymous user id, minting it under a cross-process lock on first use; an unwritable home still yields an in-memory id for the run. */
export function getOrCreateAnonymousUserId(options: AnonymousUserIdOptions = {}): AnonymousUserId {
  const file = join(resolveDshHome(undefined, options.env ?? process.env), ANONYMOUS_USER_ID_FILE_NAME)
  const cached = memo.get(file)
  if (cached !== undefined) return cached

  const id = readPersistedId(file)
    ?? publishId(file, (options.randomUUID ?? randomUUID)() as AnonymousUserId, options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS)
  memo.set(file, id)
  return id
}
