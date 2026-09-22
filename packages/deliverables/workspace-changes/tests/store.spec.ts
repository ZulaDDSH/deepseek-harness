/** Durable record storage: the session directory rule, the on-disk record, and retention pruning. */
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isStoredRecord, pruneRoot, readRecord, sessionDirectory,
  STORE_VERSION, writeRecord, type RetentionPolicy, type StoredRecord,
} from '../src/store.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function record(over: Partial<StoredRecord> = {}): StoredRecord {
  return {
    version: STORE_VERSION,
    summary: {
      turn: 1,
      cwd: '/workspace',
      files: [{ path: 'a.txt', display: 'a.txt', added: 1, deleted: 0 }],
      total: 1,
      added: 1,
      deleted: 0,
    },
    sources: [{ before: { kind: 'absent' }, after: { kind: 'file', name: 'abc', binary: false } }],
    ...over,
  }
}

describe('session directory', () => {
  it('keeps a plain id and disambiguates one that needs sanitizing', () => {
    expect(sessionDirectory('/root', 'session-abc_1.2')).toBe(join('/root', 'session-abc_1.2'))
    // A separator never reaches the path, and the digest keeps distinct ids apart.
    const unsafe = sessionDirectory('/root', 'a/b')
    expect(unsafe.startsWith(join('/root', 'a_b-'))).toBe(true)
    expect(sessionDirectory('/root', 'a?b')).not.toBe(unsafe)
  })

})

describe('stored records', () => {
  it('round-trips a record and reports one that was never written', async () => {
    const directory = await scratch('dsh-store-')
    await writeRecord(directory, 7, record())
    expect(await readRecord(directory, 7)).toEqual(record())
    expect(await readRecord(directory, 8)).toBeUndefined()
    expect(await readRecord(join(directory, 'absent'), 7)).toBeUndefined()
  })

  it('ignores a record that is unreadable, undecodable, or foreign', async () => {
    const directory = await scratch('dsh-store-')
    const records = join(directory, 'records')
    await mkdir(records, { recursive: true })
    await writeFile(join(records, '1.json'), 'not json')
    expect(await readRecord(directory, 1)).toBeUndefined()
    await writeFile(join(records, '2.json'), JSON.stringify({ ...record(), version: STORE_VERSION + 1 }))
    expect(await readRecord(directory, 2)).toBeUndefined()
  })

  it('accepts only a current-version record whose files and sources align', () => {
    expect(isStoredRecord(record())).toBe(true)
    expect(isStoredRecord(record({ sources: [{ refusal: 'binary' }] }))).toBe(true)
    expect(isStoredRecord(record({ sources: [{ before: { kind: 'snapshot', tree: 't', path: 'p' }, after: { kind: 'absent' } }] }))).toBe(true)
    // Not an object, or a version this build does not serve.
    expect(isStoredRecord(null)).toBe(false)
    expect(isStoredRecord([])).toBe(false)
    expect(isStoredRecord({ ...record(), version: 0 })).toBe(false)
    // A malformed summary.
    expect(isStoredRecord({ ...record(), summary: 'x' })).toBe(false)
    expect(isStoredRecord({ ...record(), sources: 'x' })).toBe(false)
    expect(isStoredRecord({ ...record(), summary: { ...record().summary, cwd: 1 } })).toBe(false)
    expect(isStoredRecord({ ...record(), summary: { ...record().summary, files: 'x' } })).toBe(false)
    // Files and sources must be index-aligned.
    expect(isStoredRecord(record({ sources: [] }))).toBe(false)
  })

  it('rejects a source with an unknown refusal or a malformed side', () => {
    const withSource = (source: unknown): unknown => ({ ...record(), sources: [source] })
    expect(isStoredRecord(withSource({ refusal: 'other' }))).toBe(false)
    expect(isStoredRecord(withSource('x'))).toBe(false)
    expect(isStoredRecord(withSource({ before: 'x' }))).toBe(false)
    expect(isStoredRecord(withSource({ before: { kind: 'other' } }))).toBe(false)
    expect(isStoredRecord(withSource({ before: { kind: 'file', name: 'a' } }))).toBe(false)
    expect(isStoredRecord(withSource({ before: { kind: 'snapshot', tree: 't' } }))).toBe(false)
  })
})

describe('retention', () => {
  const policy: RetentionPolicy = { maxSessions: 10, maxBytes: 1_000_000, maxAgeMs: 1_000 }

  /** One session directory holding `bytes` of records, last touched `ageMs` ago. */
  async function session(root: string, name: string, bytes: number, ageMs: number): Promise<string> {
    const directory = join(root, name)
    const records = join(directory, 'records')
    await mkdir(records, { recursive: true })
    const file = join(records, '1.json')
    await writeFile(file, 'x'.repeat(bytes))
    const when = new Date(Date.now() - ageMs)
    // Age the whole tree: a Session is as old as the newest thing in it.
    await utimes(file, when, when)
    await utimes(records, when, when)
    await utimes(directory, when, when)
    return directory
  }

  it('reports nothing to prune for a root that does not exist', async () => {
    const root = await scratch('dsh-prune-')
    expect(await pruneRoot(join(root, 'absent'), policy, Date.now())).toBe(0)
  })

  it('keeps a session directory that holds no files yet', async () => {
    const root = await scratch('dsh-prune-')
    const empty = join(root, 'empty')
    await mkdir(empty, { recursive: true })
    // The directory is older than the age bound but holds nothing; its own mtime decides.
    expect(await pruneRoot(root, policy, Date.now())).toBe(0)
    expect((await readdir(root))).toEqual(['empty'])
  })

  it('removes an expired session and leaves a fresh one', async () => {
    const root = await scratch('dsh-prune-')
    await session(root, 'old', 10, 5_000)
    await session(root, 'fresh', 10, 0)
    expect(await pruneRoot(root, policy, Date.now())).toBe(1)
    expect(await readdir(root)).toEqual(['fresh'])
  })

  it('keeps the newest sessions up to the count bound', async () => {
    const root = await scratch('dsh-prune-')
    await session(root, 'oldest', 10, 3_000)
    await session(root, 'middle', 10, 2_000)
    await session(root, 'newest', 10, 0)
    const bounded: RetentionPolicy = { maxSessions: 2, maxBytes: 1_000_000, maxAgeMs: 1_000_000 }
    expect(await pruneRoot(root, bounded, Date.now())).toBe(1)
    expect((await readdir(root)).sort()).toEqual(['middle', 'newest'])
  })

  it('keeps the newest sessions up to the byte bound and never removes the newest', async () => {
    const root = await scratch('dsh-prune-')
    await session(root, 'big', 800, 2_000)
    await session(root, 'newer', 800, 1_000)
    await session(root, 'newest', 800, 0)
    const bounded: RetentionPolicy = { maxSessions: 10, maxBytes: 1_500, maxAgeMs: 1_000_000 }
    expect(await pruneRoot(root, bounded, Date.now())).toBe(2)
    // The newest survives even though it alone exceeds nothing but the pair does.
    expect(await readdir(root)).toEqual(['newest'])
  })

  it('ignores entries that are not session directories', async () => {
    const root = await scratch('dsh-prune-')
    await writeFile(join(root, 'stray.txt'), 'x')
    await session(root, 'kept', 10, 0)
    expect(await pruneRoot(root, policy, Date.now())).toBe(0)
    expect((await readdir(root)).sort()).toEqual(['kept', 'stray.txt'])
  })

  it('counts a nested session directory toward the byte bound', async () => {
    const root = await scratch('dsh-prune-')
    const nested = join(root, 'nested')
    await mkdir(join(nested, 'objects', 'ab'), { recursive: true })
    const blob = join(nested, 'objects', 'ab', 'blob')
    await writeFile(blob, 'x'.repeat(2_000))
    const old = new Date(Date.now() - 5_000)
    await utimes(blob, old, old)
    await utimes(join(nested, 'objects', 'ab'), old, old)
    await utimes(join(nested, 'objects'), old, old)
    await utimes(nested, old, old)
    await session(root, 'fresh', 10, 0)
    expect(await pruneRoot(root, { ...policy, maxBytes: 1_000 }, Date.now())).toBe(1)
    expect(await readdir(root)).toEqual(['fresh'])
  })

  it('measures an existing directory through its own stat', async () => {
    const root = await scratch('dsh-prune-')
    const directory = await session(root, 'measured', 10, 0)
    expect((await stat(directory)).isDirectory()).toBe(true)
    expect(await pruneRoot(root, policy, Date.now())).toBe(0)
  })
})
