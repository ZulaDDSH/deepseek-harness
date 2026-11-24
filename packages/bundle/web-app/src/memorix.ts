/**
 * The launch recipe of the Memorix MCP server this bundle ships, provided as
 * {@link MEMORIX_LAUNCH_SERVICE} for the `memory-memorix` row.
 * @module @deepseek-ai/dsh-web-app/memorix
 */

import { copyFileSync, existsSync, linkSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

/** Suffix of the one-time pre-upgrade copy; must stay stable so an existing backup is never repeated. */
export const BACKUP_SUFFIX = '.dsh-pre-1.9.10.bak'

const SIDECARS = ['', '-wal', '-shm']

/** Must run before Memorix 1.9.10 first opens the database, which can upgrade it in place.
 * @param dataDirectory - directory that must hold memorix.db for a copy to be made; defaults to MEMORIX_DATA_DIR, then ~/.memorix/data.
 * @returns the backup path, or undefined when no backup must be made (no database, or one already exists).
 */
export function backupExistingDatabase(dataDirectory = resolve(process.env['MEMORIX_DATA_DIR'] || join(homedir(), '.memorix', 'data'))): string | undefined {
  const database = join(dataDirectory, 'memorix.db')
  const backup = `${database}${BACKUP_SUFFIX}`
  if (!existsSync(database)) return undefined
  if (existsSync(backup)) {
    const kept = statSync(backup)
    if (!kept.isFile() || kept.size === 0) throw new Error(`existing Memorix backup ${backup} is not a usable file`)
    return undefined
  }
  const staging = mkdtempSync(join(dataDirectory, '.dsh-memorix-backup-'))
  const created: string[] = []
  try {
    for (const suffix of SIDECARS) {
      const source = `${database}${suffix}`
      if (!existsSync(source)) continue
      const copy = join(staging, `memorix.db${suffix}`)
      copyFileSync(source, copy)
      if (statSync(copy).size !== statSync(source).size) throw new Error(`${source} changed while it was being copied`)
    }
    for (const suffix of SIDECARS.slice(1)) {
      const source = join(staging, `memorix.db${suffix}`)
      if (!existsSync(source)) continue
      const target = `${backup}${suffix}`
      linkSync(source, target)
      created.push(target)
    }
    linkSync(join(staging, 'memorix.db'), backup)
    created.push(backup)
    rmSync(staging, { recursive: true, force: true })
  } catch (error) {
    const cleanupErrors: unknown[] = []
    for (const path of created.reverse()) {
      try { rmSync(path, { force: true }) }
      catch (cleanupError) { cleanupErrors.push(cleanupError) }
    }
    try { rmSync(staging, { recursive: true, force: true }) }
    catch (cleanupError) { cleanupErrors.push(cleanupError) }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], `Memorix backup failed; ${cleanupErrors.length} paths created by this attempt could not be removed`)
    }
    throw error
  }
  return backup
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
 * Back up an existing database, then provide the launch recipe. A failed backup is logged and withholds the recipe; the Host still starts.
 * @param ctx - plugin context that receives the service.
 */
export function apply(ctx: Context): void {
  try {
    const backup = backupExistingDatabase()
    if (backup !== undefined) ctx.logger.info(`memorix-launch: kept a copy of the existing Memorix database at ${backup}`)
  } catch (error) {
    ctx.logger.warn(`memorix-launch: could not back up the existing Memorix database, so Memorix is not started: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  ctx.provide(MEMORIX_LAUNCH_SERVICE, memorixLaunch())
}
