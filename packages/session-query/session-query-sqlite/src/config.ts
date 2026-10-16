/**
 * Configuration of the SQLite session-search index: the validated shape the
 * service runs with, and the resolver that defaults and checks it.
 *
 * @module @deepseek-ai/dsh-session-query-sqlite/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import type { Config as SessionQueryConfig } from '@deepseek-ai/dsh-session-query'
import {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  SESSION_QUERY_READ_WINDOW_MAX,
  SessionQueryError,
} from '@deepseek-ai/dsh-session-query'
import { SQLITE_MAX_PAGE_LIMIT } from './query.ts'
import type { JournalMode } from './schema.ts'

/** Default result page size. */
export const SESSION_QUERY_SQLITE_DEFAULT_LIMIT = 20
/** Maximum accepted result page size. */
export const SESSION_QUERY_SQLITE_MAX_LIMIT = 100
/** Default maximum snippet length in Unicode code points. */
export const SESSION_QUERY_SQLITE_SNIPPET_CHARS = 240

/** SQLite module/handle opening phase; `never` disables full-text search entirely. */
export type OpenAt = 'startup' | 'first-search' | 'never'

/** Combined session-query configuration backed by SQLite full-text search. */
export interface Config extends SessionQueryConfig {
  /**
   * Dedicated derived-index path; `:memory:` is supported for ephemeral
   * indexes. Missing directories and database files are created owner-only on
   * POSIX filesystems; existing modes are preserved.
   */
  path: string
  /**
   * Open the SQLite module and handle at service activation or the first
   * search, or `never` to disable full-text search: the inherited exact
   * reads, filters, and traces stay available, while `searchSessions` and
   * `searchEvents` fail with `SESSION_QUERY_SEARCH_DISABLED` and SQLite is
   * never imported or opened. Defaults to `startup`.
   */
  openAt?: OpenAt
  /** SQLite journal mode. Defaults to `wal`. */
  journalMode?: JournalMode
  /** Page size when a request omits `limit`. At most `Number.MAX_SAFE_INTEGER - 1`; defaults to 20. */
  defaultLimit?: number
  /** Largest accepted page size. At most `Number.MAX_SAFE_INTEGER - 1`; defaults to 100. */
  maxLimit?: number
  /** Maximum snippet length in Unicode code points. Defaults to 240. */
  snippetChars?: number
  /** Maximum concurrent persisted-log reads in one inherited batch read. Defaults to 4. */
  persistedReadConcurrency?: number
  /** Maximum cold prepared-Session observations the inherited reader retains for reuse. Defaults to 5. */
  preparedSessionCacheSize?: number
  /** Whether full-text search is on; turning it off refuses searches now and removes the index at the next start. Defaults to on. */
  contentSearch?: Volatile<boolean>
}

/** A {@link Config} with every default applied, ready for the reader to use. */
export interface ResolvedConfig {
  path: string
  openAt: OpenAt
  journalMode: JournalMode
  defaultLimit: number
  maxLimit: number
  snippetChars: number
  readWindowMax: number
  persistedReadConcurrency: number
  preparedSessionCacheSize: number
  contentSearch: () => boolean
}

/**
 * Apply defaults to a Config and reject blank or out-of-range values.
 * @param config - caller-supplied options; omitted fields take their defaults.
 * @returns the fully resolved configuration.
 * @throws when a required value such as the path is blank or a limit is invalid.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    path: config.path,
    openAt: config.openAt ?? 'startup',
    journalMode: config.journalMode ?? 'wal',
    defaultLimit: config.defaultLimit ?? SESSION_QUERY_SQLITE_DEFAULT_LIMIT,
    maxLimit: config.maxLimit ?? SESSION_QUERY_SQLITE_MAX_LIMIT,
    snippetChars: config.snippetChars ?? SESSION_QUERY_SQLITE_SNIPPET_CHARS,
    readWindowMax: config.readWindowMax ?? SESSION_QUERY_READ_WINDOW_MAX,
    persistedReadConcurrency: config.persistedReadConcurrency
      ?? SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
    preparedSessionCacheSize: config.preparedSessionCacheSize
      ?? SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE,
    contentSearch: () => config.contentSearch?.get() ?? true,
  }
  if (typeof resolved.path !== 'string' || resolved.path.trim().length === 0) {
    throw invalidConfig('path must not be blank')
  }
  const openPhases: readonly string[] = ['startup', 'first-search', 'never']
  if (!openPhases.includes(resolved.openAt)) throw invalidConfig('openAt is not supported')
  assertPageLimit('defaultLimit', resolved.defaultLimit)
  assertPageLimit('maxLimit', resolved.maxLimit)
  assertPositiveInteger('snippetChars', resolved.snippetChars)
  if (!Number.isInteger(resolved.readWindowMax) || resolved.readWindowMax < 0) {
    throw invalidConfig('readWindowMax must be a non-negative integer')
  }
  if (
    !Number.isSafeInteger(resolved.persistedReadConcurrency)
    || resolved.persistedReadConcurrency < 1
  ) {
    throw invalidConfig('persistedReadConcurrency must be a positive safe integer')
  }
  if (
    !Number.isSafeInteger(resolved.preparedSessionCacheSize)
    || resolved.preparedSessionCacheSize < 1
  ) {
    throw invalidConfig('preparedSessionCacheSize must be a positive safe integer')
  }
  if (resolved.defaultLimit > resolved.maxLimit) {
    throw invalidConfig('defaultLimit must be less than or equal to maxLimit')
  }
  const journalModes: readonly string[] = ['wal', 'delete', 'truncate', 'persist']
  if (!journalModes.includes(resolved.journalMode)) throw invalidConfig('journalMode is not supported')
  return resolved
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw invalidConfig(`${name} must be a positive integer`)
}

function assertPageLimit(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > SQLITE_MAX_PAGE_LIMIT) {
    throw invalidConfig(`${name} must be an integer between 1 and ${SQLITE_MAX_PAGE_LIMIT}`)
  }
}

function invalidConfig(detail: string): SessionQueryError {
  return new SessionQueryError(
    `session-search SQLite config: ${detail}`,
    'SESSION_QUERY_INVALID_CONFIG',
  )
}
