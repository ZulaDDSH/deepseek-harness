import type { Stats } from 'node:fs'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveFileVerbatim, storedFilePath, verifiedStoredFilePath } from '../src/file-store.ts'

const control = vi.hoisted(() => ({ staleStat: undefined as Stats | undefined }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    statSync: ((...args: Parameters<typeof actual.statSync>) => {
      const real = actual.statSync(...args)
      return control.staleStat ?? real
    }) as typeof actual.statSync,
  }
})

const homes: string[] = []

afterEach(async () => {
  control.staleStat = undefined
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true, maxRetries: 3 })))
})

describe('verified stored file path', () => {
  it('withholds the path when the opened file differs from an earlier stat of the same path', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-stored-file-path-'))
    homes.push(home)
    const root = join(home, 'attachments', 'v1')
    const ref = await saveFileVerbatim(root, { data: Uint8Array.of(1, 2, 3, 4), name: 'a.bin' })
    const path = storedFilePath(root, ref)
    expect(verifiedStoredFilePath(root, ref, 1 << 20)).toBe(path)
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    control.staleStat = actual.statSync(path)
    await chmod(path, 0o600)
    await writeFile(path, Uint8Array.of(4, 3, 2, 1))

    expect(verifiedStoredFilePath(root, ref, 1 << 20)).toBeUndefined()
  })
})
