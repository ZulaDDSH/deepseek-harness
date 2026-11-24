import * as fs from 'node:fs'
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANONYMOUS_USER_ID_FILE_NAME, getOrCreateAnonymousUserId } from '../src/index.ts'

const replaceAfterFirstStat = vi.hoisted(() => ({ path: '' }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    statSync: ((path: string, ...rest: unknown[]) => {
      const seen = (actual.statSync as (...args: unknown[]) => unknown)(path, ...rest)
      if (path === replaceAfterFirstStat.path) {
        replaceAfterFirstStat.path = ''
        actual.rmSync(path)
        actual.writeFileSync(path, 'live\n')
      }
      return seen
    }) as typeof actual.statSync,
  }
})

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('stale lock recovery', () => {
  it('keeps a lock that another process replaced after the staleness check', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-userid-race-'))
    dirs.push(home)
    const lock = join(home, `${ANONYMOUS_USER_ID_FILE_NAME}.lock`)
    writeFileSync(lock, '1\n', 'utf8')
    const old = new Date(Date.now() - 60_000)
    utimesSync(lock, old, old)
    replaceAfterFirstStat.path = lock
    getOrCreateAnonymousUserId({ env: { DSH_HOME: home }, lockTimeoutMs: 30 })
    expect(fs.existsSync(lock)).toBe(true)
    expect(readFileSync(lock, 'utf8')).toBe('live\n')
  })
})
