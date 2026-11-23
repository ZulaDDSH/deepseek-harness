import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AtomicWriteSyncError, writeFileAtomic } from '../src/index.ts'

const state = vi.hoisted(() => ({
  events: [] as string[],
  fileSyncError: undefined as Error | undefined,
  directorySyncError: undefined as Error | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: (async (...args: Parameters<typeof actual.rename>) => {
      state.events.push('rename')
      return actual.rename(...args)
    }),
    open: (async (path: string, flags: string, mode?: number) => {
      if (flags === 'r') {
        state.events.push('open-directory')
        return {
          sync: async () => {
            state.events.push('sync-directory')
            if (state.directorySyncError !== undefined) throw state.directorySyncError
          },
          close: async () => undefined,
        }
      }
      const handle = await actual.open(path, flags, mode)
      return {
        writeFile: (content: string) => handle.writeFile(content),
        sync: async () => {
          state.events.push('sync-file')
          if (state.fileSyncError !== undefined) throw state.fileSyncError
          await handle.sync()
        },
        close: () => handle.close(),
      }
    }),
  }
})

const dirs: string[] = []

afterEach(async () => {
  state.events.length = 0
  state.fileSyncError = undefined
  state.directorySyncError = undefined
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { force: true, recursive: true, maxRetries: 10, retryDelay: 20 })))
})

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-atomic-durability-'))
  dirs.push(dir)
  return dir
}

function platform(value: NodeJS.Platform): void {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(value)
}

describe('writeFileAtomic durability', () => {
  it('syncs the file before the rename and the directory after it', async () => {
    platform('linux')
    const target = join(await scratch(), 'a.json')
    await writeFileAtomic(target, 'next', { mode: 0o600 })
    expect(state.events).toEqual(['sync-file', 'rename', 'open-directory', 'sync-directory'])
    expect(await readFile(target, 'utf8')).toBe('next')
  })

  it('does not publish and removes the temp file when the file sync fails', async () => {
    platform('linux')
    const dir = await scratch()
    state.fileSyncError = Object.assign(new Error('EIO'), { code: 'EIO' })
    await expect(writeFileAtomic(join(dir, 'a.json'), 'next', { mode: 0o600 })).rejects.toThrow('EIO')
    expect(state.events).toEqual(['sync-file'])
    expect(await readdir(dir)).toEqual([])
  })

  it('reports an unsynced directory after publication instead of success', async () => {
    platform('linux')
    const target = join(await scratch(), 'a.json')
    state.directorySyncError = Object.assign(new Error('EIO'), { code: 'EIO' })
    const failure = await writeFileAtomic(target, 'next', { mode: 0o600 }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AtomicWriteSyncError)
    expect(failure).toMatchObject({ code: 'ATOMIC_WRITE_UNSYNCED', path: target })
    expect(await readFile(target, 'utf8')).toBe('next')
  })

  it('treats a filesystem without directory sync as nothing to sync', async () => {
    platform('linux')
    const target = join(await scratch(), 'a.json')
    state.directorySyncError = Object.assign(new Error('EINVAL'), { code: 'EINVAL' })
    await expect(writeFileAtomic(target, 'next', { mode: 0o600 })).resolves.toBeUndefined()
  })

  it('skips the directory sync on Windows, which cannot open a directory', async () => {
    platform('win32')
    const target = join(await scratch(), 'a.json')
    await writeFileAtomic(target, 'next', { mode: 0o600 })
    expect(state.events).toEqual(['sync-file', 'rename'])
  })
})
