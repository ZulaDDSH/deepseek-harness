/**
 * Atomic whole-file replacement for the JSON backend.
 *
 * Publish protocol: write a same-directory temp file, fsync it, then
 * `rename()` over the target. Rename is an atomic replace on POSIX and on
 * Windows (libuv maps it to `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`),
 * and replacement is the intended semantic here — unlike the session-log
 * backend's link()+unlink() no-clobber protocol, a unit file has exactly one
 * writer per process and last-write-wins is correct. After the rename the
 * parent directory is fsynced on POSIX so the new entry is crash-durable.
 * @module @deepseek-ai/dsh-storage-json/src/atomic
 */

import { open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { StorageError } from '@deepseek-ai/dsh-storage'
import { fsyncDirectory } from './dirsync.ts'

/**
 * Durably replace `path` with `data`.
 * @param path - Absolute target file path.
 * @param data - Full new file content.
 * @returns resolution after the replacement is crash-durable.
 */
export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`)
  let published = false
  try {
    const handle = await open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, path)
    published = true
    await fsyncDirectory(dirname(path))
  } catch (error) {
    if (published) {
      throw new StorageError('unknown-state', `'${path}' was replaced but its directory sync failed; the new content is visible and its durability is unknown`, { cause: error })
    }
    await rm(tmp, { force: true })
    throw error
  }
}
