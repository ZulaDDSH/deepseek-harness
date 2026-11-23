import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { activeSpills, sweepSpillFiles } from '../src/retention.ts'

const HOUR = 3_600_000
const NOW = Date.now()
const roots: string[] = []

function fixture(): { root: string; make: (dir: string, id: number, bytes: number, ageHours: number) => string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-retention-test-'))
  roots.push(root)
  return {
    root,
    make(dir, id, bytes, ageHours) {
      const directory = join(root, `dsh-subprocess-${dir}`)
      mkdirSync(directory, { recursive: true })
      const file = join(directory, `dsh-subprocess-1-${id}-${String(id).padStart(12, '0')}-stdout.log`)
      writeFileSync(file, Buffer.alloc(bytes))
      const when = new Date(NOW - ageHours * HOUR)
      utimesSync(file, when, when)
      return file
    },
  }
}

afterEach(() => {
  activeSpills.clear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('spill retention', () => {
  it('removes completed files past the age limit and keeps younger ones', async () => {
    const f = fixture()
    const old = f.make('abcdef', 1, 10, 200)
    const young = f.make('abcdef', 2, 10, 2)
    const result = await sweepSpillFiles({ root: f.root, now: NOW, maxAgeMs: 168 * HOUR, maxTotalBytes: 0 })
    expect(result.removed).toBe(1)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(young)).toBe(true)
  })

  it('trims the oldest files to the aggregate limit across directories but never a file under the minimum age', async () => {
    const f = fixture()
    const oldest = f.make('aaaaaa', 1, 100, 30)
    const middle = f.make('bbbbbb', 2, 100, 20)
    const fresh = f.make('bbbbbb', 3, 100, 0.1)
    await sweepSpillFiles({ root: f.root, now: NOW, maxAgeMs: 0, maxTotalBytes: 150 })
    expect(existsSync(oldest)).toBe(false)
    expect(existsSync(middle)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })

  it('does not delete anything before the caller yields', async () => {
    const f = fixture()
    const old = f.make('eeeeee', 1, 10, 200)
    const pending = sweepSpillFiles({ root: f.root, now: NOW, maxAgeMs: 168 * HOUR, maxTotalBytes: 0 })
    expect(existsSync(old)).toBe(true)
    expect((await pending).removed).toBe(1)
    expect(existsSync(old)).toBe(false)
  })

  it('skips files still open for writing and entries that are not spill files', async () => {
    const f = fixture()
    const open = f.make('cccccc', 1, 10, 500)
    activeSpills.add(open)
    const stranger = join(f.root, 'dsh-subprocess-cccccc', 'notes.txt')
    writeFileSync(stranger, 'x')
    const when = new Date(NOW - 500 * HOUR)
    utimesSync(stranger, when, when)
    await sweepSpillFiles({ root: f.root, now: NOW, maxAgeMs: HOUR, maxTotalBytes: 0 })
    expect(existsSync(open)).toBe(true)
    expect(existsSync(stranger)).toBe(true)
  })

  it('purges every completed file with a zero minimum age and drops emptied directories', async () => {
    const f = fixture()
    const file = f.make('dddddd', 1, 10, 0)
    await sweepSpillFiles({ root: f.root, now: Date.now() + 60_000, maxAgeMs: 1, minAgeMs: 0 })
    expect(existsSync(file)).toBe(false)
    expect(existsSync(join(f.root, 'dsh-subprocess-dddddd'))).toBe(false)
  })
})
