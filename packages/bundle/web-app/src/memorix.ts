/**
 * The launch recipe of the Memorix MCP server this bundle ships, provided as
 * {@link MEMORIX_LAUNCH_SERVICE} for the `memory-memorix` row.
 * @module @deepseek-ai/dsh-web-app/memorix
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { BACKUP_SUFFIX as backupSuffix, backupExistingDatabase as backupDatabase } from '../src/memorix-backup.mjs'

export const BACKUP_SUFFIX = backupSuffix

export function backupExistingDatabase(dataDirectory?: string): string | undefined {
  return backupDatabase(dataDirectory)
}

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
