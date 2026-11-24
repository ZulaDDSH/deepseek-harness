import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

const removal = vi.hoisted(() => ({ fail: false }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    rmSync: (...args: Parameters<typeof actual.rmSync>) => {
      if (removal.fail) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      actual.rmSync(...args)
    },
  }
})

const { reclaimAbandonedHandoffs, releaseHandoffs } = await import('../src/host-file.ts')

const homes: string[] = []

afterEach(async () => {
  removal.fail = false
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true, maxRetries: 3 })))
})

describe('handoff cleanup failures', () => {
  it('never lets a failed directory removal escape release or reclaim', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-handoff-cleanup-'))
    homes.push(home)
    const exited = spawnSync(process.execPath, ['-e', '0']).pid
    const crashed = join(home, `${exited}-33333333-3333-4333-8333-333333333333`)
    const owned = join(home, `${process.pid}-44444444-4444-4444-8444-444444444444`)
    await mkdir(crashed)
    await mkdir(owned)
    removal.fail = true

    expect(() => { reclaimAbandonedHandoffs(home) }).not.toThrow()
    expect(() => { releaseHandoffs(owned) }).not.toThrow()
    expect(existsSync(crashed)).toBe(true)

    removal.fail = false
    reclaimAbandonedHandoffs(home)
    expect(existsSync(crashed)).toBe(false)
  })
})
