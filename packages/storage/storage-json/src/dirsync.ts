import { open } from 'node:fs/promises'

/* v8 ignore start -- Windows requires a different directory handle; POSIX coverage exercises this. */
/** Persists directory-entry changes on POSIX; the sync requires an openable directory, so Windows skips it. */
export async function fsyncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
/* v8 ignore stop -- constraint: pairs with the start above */
