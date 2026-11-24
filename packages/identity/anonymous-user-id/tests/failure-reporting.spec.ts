import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANONYMOUS_USER_ID_FILE_NAME, getOrCreateAnonymousUserId } from '../src/index.ts'

const faults = vi.hoisted(() => [] as { op: string; code: string; suffix: string }[])

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const failing = (op: string, real: (...args: never[]) => unknown) => (path: unknown, ...rest: unknown[]) => {
    const fault = faults.find(rule => rule.op === op && String(path).endsWith(rule.suffix))
    if (fault !== undefined) throw Object.assign(new Error(`injected ${fault.code}`), { code: fault.code })
    return (real as (...args: unknown[]) => unknown)(path, ...rest)
  }
  return {
    ...actual,
    readFileSync: failing('read', actual.readFileSync),
    statSync: failing('stat', actual.statSync),
    mkdirSync: failing('mkdir', actual.mkdirSync),
    renameSync: failing('rename', actual.renameSync),
    rmSync: failing('rm', actual.rmSync),
    writeFileSync: failing('write', actual.writeFileSync),
  }
})

const dirs: string[] = []
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-userid-fail-'))
  dirs.push(dir)
  return dir
}

function inject(op: string, code: string, suffix: string): void {
  faults.push({ op, code, suffix })
}

function run(home: string, extra: { lockTimeoutMs?: number } = {}) {
  const reports: { message: string; error: unknown }[] = []
  const id = getOrCreateAnonymousUserId({
    env: { DSH_HOME: home },
    onFailure: (message, error) => { reports.push({ message, error }) },
    ...extra,
  })
  return { id, reports }
}

function codes(reports: readonly { error: unknown }[]): unknown[] {
  return reports.map(report => (report.error as { code?: string }).code)
}

afterEach(() => {
  faults.length = 0
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('best-effort failures are surfaced', () => {
  it('stays silent when the id file is absent or its parent is a file', () => {
    for (const code of ['ENOENT', 'ENOTDIR']) {
      faults.length = 0
      inject('read', code, ANONYMOUS_USER_ID_FILE_NAME)
      const { id, reports } = run(tempHome())
      expect(id).toMatch(UUID)
      expect(reports).toEqual([])
    }
  })

  it('reports an unreadable id file and still returns an id', () => {
    inject('read', 'EACCES', ANONYMOUS_USER_ID_FILE_NAME)
    const { id, reports } = run(tempHome())
    expect(id).toMatch(UUID)
    expect(new Set(codes(reports))).toEqual(new Set(['EACCES']))
    expect(reports[0]?.message).toContain(ANONYMOUS_USER_ID_FILE_NAME)
  })

  it('reports a home that cannot be created and still returns an id', () => {
    inject('mkdir', 'EACCES', '')
    const { id, reports } = run(join(tempHome(), 'nested'))
    expect(id).toMatch(UUID)
    expect(codes(reports)).toEqual(['EACCES'])
  })

  it('reports a failed temp write and still returns an id', () => {
    inject('write', 'EROFS', '.tmp')
    const { id, reports } = run(tempHome())
    expect(id).toMatch(UUID)
    expect(codes(reports)).toEqual(['EROFS'])
  })

  it('reports a failed rename and still returns an id', () => {
    inject('rename', 'EPERM', '')
    const { id, reports } = run(tempHome())
    expect(id).toMatch(UUID)
    expect(codes(reports)).toEqual(['EPERM'])
  })

  it('reports a failed temp cleanup after a failed write without throwing', () => {
    inject('write', 'EROFS', '.tmp')
    inject('rm', 'EACCES', '.tmp')
    const { id, reports } = run(tempHome())
    expect(id).toMatch(UUID)
    expect(codes(reports)).toEqual(['EROFS', 'EACCES'])
  })

  it('reports a lock that cannot be statted, but not one that vanished', () => {
    const held = tempHome()
    writeFileSync(join(held, `${ANONYMOUS_USER_ID_FILE_NAME}.lock`), '1\n', 'utf8')
    inject('stat', 'ENOENT', '.lock')
    expect(run(held, { lockTimeoutMs: 30 }).reports).toEqual([])
    faults.length = 0
    const denied = tempHome()
    writeFileSync(join(denied, `${ANONYMOUS_USER_ID_FILE_NAME}.lock`), '1\n', 'utf8')
    inject('stat', 'EACCES', '.lock')
    const { id, reports } = run(denied, { lockTimeoutMs: 30 })
    expect(id).toMatch(UUID)
    expect(new Set(codes(reports))).toEqual(new Set(['EACCES']))
  })

  it('reports a stale lock that cannot be removed, but not one that is busy', () => {
    const stale = (): string => {
      const home = tempHome()
      const lock = join(home, `${ANONYMOUS_USER_ID_FILE_NAME}.lock`)
      writeFileSync(lock, '1\n', 'utf8')
      const old = new Date(Date.now() - 60_000)
      utimesSync(lock, old, old)
      return home
    }
    inject('rm', 'EBUSY', '.lock')
    expect(run(stale(), { lockTimeoutMs: 30 }).reports).toEqual([])
    faults.length = 0
    inject('rm', 'EACCES', '.lock')
    const { id, reports } = run(stale(), { lockTimeoutMs: 30 })
    expect(id).toMatch(UUID)
    expect(new Set(codes(reports))).toEqual(new Set(['EACCES']))
  })

  it('reports a lock that cannot be released without throwing', () => {
    inject('rm', 'EACCES', '.lock')
    const { id, reports } = run(tempHome())
    expect(id).toMatch(UUID)
    expect(codes(reports)).toEqual(['EACCES'])
  })

  it('writes a stderr line when no reporter is supplied', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    inject('mkdir', 'EACCES', '')
    const id = getOrCreateAnonymousUserId({ env: { DSH_HOME: join(tempHome(), 'nested') } })
    expect(id).toMatch(UUID)
    expect(write).toHaveBeenCalledTimes(1)
    expect(String(write.mock.calls[0]?.[0])).toContain('EACCES')
  })
})
