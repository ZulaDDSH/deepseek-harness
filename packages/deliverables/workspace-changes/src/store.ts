/**
 * Durable form of recorded turn changes: the served summary plus the two
 * content sources of every listed file, written beside the snapshot objects and
 * captured copies they reference. A record outlives its Session, so a
 * conversation reopened after a Host restart keeps its cards and comparisons.
 * @module @deepseek-ai/dsh-workspace-changes/store
 */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkspaceChangesSummary } from './types.ts'

/** Current on-disk record version; a record of another version is ignored. */
export const STORE_VERSION = 1

/** One side of a stored comparison. */
export type StoredSide =
  /** No file at the path. */
  | { kind: 'absent' }
  /** A stored copy, named by the SHA-1 of its bytes inside the session's `captures` directory. */
  | { kind: 'file'; name: string; binary: boolean }
  /** A path in a snapshot tree held by the session's private object store. */
  | { kind: 'snapshot'; tree: string; path: string }

/** What one listed file's comparison reads, index-aligned with the summary's `files`. */
export interface StoredSources {
  /** A refusal decided when the turn was recorded. */
  refusal?: 'binary' | 'oversized'
  /** The turn-start side. */
  before?: StoredSide
  /** The turn-end side. */
  after?: StoredSide
}

/** One durable turn record. */
export interface StoredRecord {
  /** On-disk version of this record. */
  version: typeof STORE_VERSION
  /** The summary served for the announcing event's sequence. */
  summary: WorkspaceChangesSummary
  /** Index-aligned content sources. */
  sources: StoredSources[]
}

/** Retention bounds applied to the durable root. */
export interface RetentionPolicy {
  /** Sessions to keep, newest first. */
  maxSessions: number
  /** Bytes to keep across the root, oldest records removed first. */
  maxBytes: number
  /** Age in milliseconds past which a session directory is removed. */
  maxAgeMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSide(value: unknown): value is StoredSide {
  if (!isRecord(value)) return false
  switch (value['kind']) {
    case 'absent': return true
    case 'file': return typeof value['name'] === 'string' && typeof value['binary'] === 'boolean'
    case 'snapshot': return typeof value['tree'] === 'string' && typeof value['path'] === 'string'
    default: return false
  }
}

function isSources(value: unknown): value is StoredSources {
  if (!isRecord(value)) return false
  const refusal = value['refusal']
  if (refusal !== undefined && refusal !== 'binary' && refusal !== 'oversized') return false
  return (value['before'] === undefined || isSide(value['before']))
    && (value['after'] === undefined || isSide(value['after']))
}

/**
 * Whether a decoded document is a record this build can serve. Summaries are
 * written by this package, so a document that fails here is a foreign or
 * truncated file and is ignored rather than repaired.
 * @param value - decoded JSON.
 * @returns whether the value is a current-version record.
 */
export function isStoredRecord(value: unknown): value is StoredRecord {
  if (!isRecord(value) || value['version'] !== STORE_VERSION) return false
  const summary = value['summary']
  const sources = value['sources']
  if (!isRecord(summary) || !Array.isArray(sources)) return false
  if (typeof summary['cwd'] !== 'string' || !Array.isArray(summary['files'])) return false
  if (summary['files'].length !== sources.length) return false
  return sources.every(isSources)
}

/**
 * The durable directory of one Session. The id is sanitized because it reaches
 * a path segment; distinct ids that sanitize alike are distinguished by a hash
 * of the original, so two Sessions never share a directory.
 * @param root - durable root.
 * @param sessionId - owning Session id.
 * @returns the absolute session directory.
 */
export function sessionDirectory(root: string, sessionId: string): string {
  const safe = sessionId.replaceAll(/[^A-Za-z0-9._-]/g, '_')
  return safe === sessionId ? join(root, safe) : join(root, `${safe}-${hashOf(sessionId)}`)
}

/** A short stable digest of one string, used only to disambiguate sanitized ids. */
function hashOf(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const recordsDirectory = (directory: string): string => join(directory, 'records')

/**
 * Write one record so a crash cannot leave a half-written file behind.
 * @param directory - the Session's durable directory.
 * @param seq - the announcing event's sequence.
 * @param record - the record to store.
 * @returns after the record is durable.
 */
export async function writeRecord(directory: string, seq: number, record: StoredRecord): Promise<void> {
  const records = recordsDirectory(directory)
  await mkdir(records, { recursive: true })
  const target = join(records, `${String(seq)}.json`)
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(record))
  await rename(temporary, target)
}

/**
 * Read one stored record.
 * @param directory - the Session's durable directory.
 * @param seq - the announcing event's sequence.
 * @returns the record, or undefined when it was never stored or is unreadable.
 */
export async function readRecord(directory: string, seq: number): Promise<StoredRecord | undefined> {
  let text: string
  try {
    text = await readFile(join(recordsDirectory(directory), `${String(seq)}.json`), 'utf8')
  } catch {
    return undefined
  }
  try {
    const value: unknown = JSON.parse(text)
    return isStoredRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** One session directory with the facts retention sorts and bounds it by. */
interface SessionFootprint {
  path: string
  bytes: number
  modifiedMs: number
}

async function footprintOf(path: string): Promise<SessionFootprint> {
  let bytes = 0
  // The directory's own mtime is the age baseline: a Session directory whose
  // files are still being written, or that holds none yet, is not expired.
  let modifiedMs = 0
  try {
    modifiedMs = (await stat(path)).mtimeMs
  } catch {
    // A directory removed under the walk is not a pruning candidate.
  }
  const walk = async (current: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      try {
        const info = await stat(full)
        bytes += info.size
        modifiedMs = Math.max(modifiedMs, info.mtimeMs)
      } catch {
        // A file removed under the walk simply stops counting.
      }
    }
  }
  await walk(path)
  return { path, bytes, modifiedMs }
}

/**
 * Apply the retention policy to the durable root: sessions older than the age
 * bound are removed, then the oldest remaining sessions are removed until the
 * count and byte bounds hold. A session newer than the age bound is never
 * removed for age, and the bounds are enforced oldest-first so the most recent
 * review keeps its content longest.
 * @param root - durable root.
 * @param policy - configured bounds.
 * @param now - current time in milliseconds.
 * @returns the removed session directory count.
 */
export async function pruneRoot(root: string, policy: RetentionPolicy, now: number): Promise<number> {
  let names
  try {
    names = await readdir(root, { withFileTypes: true })
  } catch {
    return 0
  }
  const sessions: SessionFootprint[] = []
  for (const entry of names) {
    if (!entry.isDirectory()) continue
    sessions.push(await footprintOf(join(root, entry.name)))
  }
  sessions.sort((left, right) => right.modifiedMs - left.modifiedMs)
  const doomed = new Set<string>()
  let bytes = 0
  let kept = 0
  for (const session of sessions) {
    const expired = now - session.modifiedMs > policy.maxAgeMs
    const overCount = kept >= policy.maxSessions
    const overBytes = kept > 0 && bytes + session.bytes > policy.maxBytes
    if (expired || overCount || overBytes) {
      doomed.add(session.path)
      continue
    }
    kept += 1
    bytes += session.bytes
  }
  for (const path of doomed) await rm(path, { recursive: true, force: true })
  return doomed.size
}
