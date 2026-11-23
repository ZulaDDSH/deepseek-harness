import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureFile } from '../src/capture.ts'
import { STORE_VERSION, ensurePrivateDirectory, writeRecord } from '../src/store.ts'

const calls = vi.hoisted(() => ({ mkdir: [] as unknown[][], writeFile: [] as unknown[][] }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdir: (...args: Parameters<typeof actual.mkdir>) => { calls.mkdir.push(args); return actual.mkdir(...args) },
    writeFile: (...args: Parameters<typeof actual.writeFile>) => { calls.writeFile.push(args); return actual.writeFile(...args) },
  }
})

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  calls.mkdir.length = 0
  calls.writeFile.length = 0
})

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-private-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const record = {
  version: STORE_VERSION,
  summary: { turn: 1, cwd: '/w', files: [], total: 0, added: 0, deleted: 0 },
  sources: [],
}

describe('private filesystem modes', () => {
  it('creates directories owner-only', async () => {
    const dir = join(await scratch(), 'a', 'b')
    await ensurePrivateDirectory(dir)
    expect(calls.mkdir).toEqual([[dir, { recursive: true, mode: 0o700 }]])
  })

  it('writes captured copies owner-only into an owner-only directory', async () => {
    const root = await scratch()
    const source = join(root, 'source.txt')
    await writeFile(source, 'secret')
    calls.writeFile.length = 0
    const captures = join(root, 'session', 'captures')
    const capture = await captureFile(source, captures, 1024)
    expect(capture).toMatchObject({ kind: 'file' })
    expect(calls.mkdir).toEqual([[captures, { recursive: true, mode: 0o700 }]])
    expect(calls.writeFile).toEqual([[expect.stringContaining(captures), expect.anything(), { flag: 'wx', mode: 0o600 }]])
  })

  it('writes records owner-only', async () => {
    const directory = join(await scratch(), 'session')
    await writeRecord(directory, 3, record)
    expect(calls.mkdir).toEqual([[join(directory, 'records'), { recursive: true, mode: 0o700 }]])
    expect(calls.writeFile).toEqual([[expect.stringMatching(/3\.json\.tmp$/), expect.any(String), { mode: 0o600 }]])
  })

  it.skipIf(process.platform === 'win32')('leaves directories and files without group or other access, and narrows an existing directory', async () => {
    const root = await scratch()
    const source = join(root, 'source.txt')
    await writeFile(source, 'secret', { mode: 0o600 })
    const directory = join(root, 'session')
    await ensurePrivateDirectory(directory)
    await ensurePrivateDirectory(directory)
    const capture = await captureFile(source, join(directory, 'captures'), 1024)
    await writeRecord(directory, 1, record)
    const modes = await Promise.all([
      stat(directory), stat(join(directory, 'captures')), stat(join(directory, 'records')),
      stat(capture?.kind === 'file' ? capture.file : source), stat(join(directory, 'records', '1.json')),
    ])
    for (const info of modes) expect(info.mode & 0o077).toBe(0)
  })
})
