import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sweepSpillFiles, sweepSpillFilesThrottled } from '../src/retention.ts'

const faults = vi.hoisted(() => [] as { op: string; code: string; match: (path: string) => boolean }[])

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const failing = (op: string, real: (...args: never[]) => Promise<unknown>) => async (path: unknown, ...rest: unknown[]) => {
    const fault = faults.find(rule => rule.op === op && rule.match(String(path)))
    if (fault !== undefined) throw Object.assign(new Error(`injected ${fault.code}`), { code: fault.code })
    return (real as (...args: unknown[]) => Promise<unknown>)(path, ...rest)
  }
  return {
    ...actual,
    lstat: failing('lstat', actual.lstat),
    readdir: failing('readdir', actual.readdir),
    rmdir: failing('rmdir', actual.rmdir),
    unlink: failing('unlink', actual.unlink),
  }
})

const HOUR = 3_600_000
const NOW = Date.now()
const roots: string[] = []

function inject(op: string, code: string, match: (path: string) => boolean): void {
  faults.push({ op, code, match })
}

function fixture(): { root: string; directory: string; file: (id: number) => string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-retention-fail-'))
  roots.push(root)
  const directory = join(root, 'dsh-subprocess-abcdef')
  mkdirSync(directory)
  return {
    root,
    directory,
    file(id) {
      const path = join(directory, `dsh-subprocess-1-${id}-${String(id).padStart(12, '0')}-stdout.log`)
      writeFileSync(path, Buffer.alloc(10))
      const when = new Date(NOW - 200 * HOUR)
      utimesSync(path, when, when)
      return path
    },
  }
}

function collect() {
  const reports: { code: unknown; step: string; path: string }[] = []
  return {
    reports,
    onFailure: (error: unknown, step: string, path: string) => { reports.push({ code: (error as { code?: string }).code, step, path }) },
  }
}

const POLICY = { maxAgeMs: 168 * HOUR, maxTotalBytes: 0 }

afterEach(() => {
  faults.length = 0
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('spill retention surfaces unexpected failures', () => {
  it('reports a file that cannot be removed and still removes the others', async () => {
    const f = fixture()
    const stuck = f.file(1)
    f.file(2)
    inject('unlink', 'EACCES', path => path === stuck)
    const { reports, onFailure } = collect()
    const result = await sweepSpillFiles({ root: f.root, now: NOW, ...POLICY, onFailure })
    expect(result.removed).toBe(1)
    expect(reports).toEqual([{ code: 'EACCES', step: 'remove spill file', path: stuck }])
  })

  it.each(['ENOENT', 'EBUSY', 'EPERM'])('does not report a file removal that fails with %s', async (code) => {
    const f = fixture()
    f.file(1)
    inject('unlink', code, () => true)
    const { reports, onFailure } = collect()
    await sweepSpillFiles({ root: f.root, now: NOW, ...POLICY, onFailure })
    expect(reports).toEqual([])
  })

  it('reports an entry that cannot be inspected, but not one that vanished', async () => {
    const f = fixture()
    const denied = f.file(1)
    const gone = f.file(2)
    inject('lstat', 'EACCES', path => path === denied)
    inject('lstat', 'ENOENT', path => path === gone)
    const { reports, onFailure } = collect()
    await sweepSpillFiles({ root: f.root, now: NOW, ...POLICY, onFailure })
    expect(reports).toEqual([{ code: 'EACCES', step: 'inspect', path: denied }])
  })

  it('reports a directory that cannot be listed, but not one that vanished', async () => {
    const f = fixture()
    inject('readdir', 'EACCES', path => path === f.directory)
    const denied = collect()
    await sweepSpillFiles({ root: f.root, now: NOW, ...POLICY, onFailure: denied.onFailure })
    expect(denied.reports).toEqual([{ code: 'EACCES', step: 'list', path: f.directory }])
    faults.length = 0
    inject('readdir', 'ENOENT', path => path === f.directory)
    const gone = collect()
    await sweepSpillFiles({ root: f.root, now: NOW, ...POLICY, onFailure: gone.onFailure })
    expect(gone.reports).toEqual([])
  })

  it('reports a directory that cannot be removed, but not one that is not empty or gone', async () => {
    const f = fixture()
    const old = new Date(NOW - 200 * HOUR)
    utimesSync(f.directory, old, old)
    inject('rmdir', 'EACCES', () => true)
    const denied = collect()
    await sweepSpillFiles({ root: f.root, now: NOW, ...POLICY, onFailure: denied.onFailure })
    expect(denied.reports).toEqual([{ code: 'EACCES', step: 'remove spill directory', path: f.directory }])
    for (const code of ['ENOTEMPTY', 'EEXIST', 'ENOENT', 'EBUSY', 'EPERM']) {
      faults.length = 0
      inject('rmdir', code, () => true)
      const quiet = collect()
      await sweepSpillFiles({ root: f.root, now: NOW, ...POLICY, onFailure: quiet.onFailure })
      expect(quiet.reports).toEqual([])
    }
  })

  it('reports a failed background sweep instead of dropping it', async () => {
    inject('readdir', 'EACCES', path => path === tmpdir())
    const { reports, onFailure } = collect()
    sweepSpillFilesThrottled(undefined, onFailure)
    await vi.waitFor(() => { expect(reports).toHaveLength(1) })
    expect(reports[0]).toEqual({ code: 'EACCES', step: 'sweep spill files', path: tmpdir() })
  })
})
