import { copyFileSync, existsSync, linkSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const BACKUP_SUFFIX = '.dsh-pre-1.9.10.bak'

const SIDECARS = ['', '-wal', '-shm']

export function backupExistingDatabase(dataDirectory = resolve(process.env['MEMORIX_DATA_DIR'] || join(homedir(), '.memorix', 'data'))) {
  const database = join(dataDirectory, 'memorix.db')
  const backup = `${database}${BACKUP_SUFFIX}`
  if (!existsSync(database) || existsSync(backup)) return undefined
  const staging = mkdtempSync(join(dataDirectory, '.dsh-memorix-backup-'))
  const created = []
  try {
    for (const suffix of SIDECARS) {
      const source = `${database}${suffix}`
      if (!existsSync(source)) continue
      copyFileSync(source, join(staging, `memorix.db${suffix}`))
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
    const cleanupErrors = []
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
