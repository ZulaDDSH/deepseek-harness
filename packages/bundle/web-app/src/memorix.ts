/**
 * The launch recipe of the Memorix MCP server this bundle ships, provided as
 * {@link MEMORIX_LAUNCH_SERVICE} for the `memory-memorix` row.
 * @module @deepseek-ai/dsh-web-app/memorix
 */

import { copyFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'memorix-launch'

/** Service provided by this plugin and injected by the Memorix MCP row. */
export const MEMORIX_LAUNCH_SERVICE = 'memorixLaunch'

/** How to start the shipped Memorix server over stdio. */
export interface MemorixLaunch {
  /** The running Node (or Electron in Node mode) executable. */
  command: string
  /** The Memorix CLI entry followed by its serve arguments. */
  args: string[]
}

/**
 * Resolve the pinned Memorix package that ships with this bundle.
 * @returns the running executable and the package's CLI entry, so no `memorix` command is looked up on PATH.
 * @throws when the memorix package is not installed beside this bundle.
 */
export function memorixLaunch(): MemorixLaunch {
  const entry = fileURLToPath(import.meta.resolve('memorix'))
  return { command: process.execPath, args: [join(dirname(entry), 'cli', 'index.js'), 'serve', '--allow-untracked'] }
}

/** Suffix of the one-time copy kept beside a Memorix database before the bundled version first opens it. */
export const BACKUP_SUFFIX = '.dsh-pre-1.9.10.bak'

const SIDECARS = ['', '-wal', '-shm']

/**
 * Keep a one-time copy of an existing Memorix database, because opening it with Memorix 1.9.10 can upgrade it in place.
 * @param dataDirectory - Memorix data directory; defaults to MEMORIX_DATA_DIR, then ~/.memorix/data.
 * @returns the backup path when a copy was made; undefined when there is no database or a backup already exists.
 */
export function backupExistingDatabase(dataDirectory = resolve(process.env['MEMORIX_DATA_DIR'] || join(homedir(), '.memorix', 'data'))): string | undefined {
  const database = join(dataDirectory, 'memorix.db')
  const backup = `${database}${BACKUP_SUFFIX}`
  if (!existsSync(database) || existsSync(backup)) return undefined
  for (const suffix of SIDECARS) {
    if (existsSync(`${database}${suffix}`)) copyFileSync(`${database}${suffix}`, `${backup}${suffix}`)
  }
  return backup
}

/**
 * Back up an existing database, then provide the launch recipe. A failed backup is logged and never blocks the Host.
 * @param ctx - plugin context that receives the service.
 */
export function apply(ctx: Context): void {
  try {
    const backup = backupExistingDatabase()
    if (backup !== undefined) ctx.logger.info(`memorix-launch: kept a copy of the existing Memorix database at ${backup}`)
  } catch (error) {
    ctx.logger.warn(`memorix-launch: could not back up the existing Memorix database: ${error instanceof Error ? error.message : String(error)}`)
  }
  ctx.provide(MEMORIX_LAUNCH_SERVICE, memorixLaunch())
}
