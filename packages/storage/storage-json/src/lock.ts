import { FileLockError, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { StorageError } from '@deepseek-ai/dsh-storage'

/** Holds the unit's host lock until the returned release runs; a live holder fails the open. */
export async function acquireUnitLock(path: string, unit: string): Promise<() => Promise<void>> {
  let release!: () => void
  const released = new Promise<void>((resolve) => { release = resolve })
  let acquired!: () => void
  const ready = new Promise<void>((resolve) => { acquired = resolve })
  const held = withFileLock(path, () => {
    acquired()
    return released
  }, { waitMs: 0 })
  const failed = held.then(() => undefined, (error: unknown) => error instanceof Error ? error : new Error(String(error)))
  const outcome = await Promise.race([ready.then(() => undefined), failed])
  if (outcome !== undefined) {
    if (outcome instanceof FileLockError) {
      throw new StorageError('locked', `unit '${unit}' is open in another host (lock ${outcome.lockPath}); stop that host or remove the lock if its process is gone`, { cause: outcome })
    }
    throw outcome
  }
  return async () => {
    release()
    await failed
  }
}
