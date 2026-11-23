import { existsSync } from 'node:fs'
import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionSeq, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { brandString } from '@deepseek-ai/dsh-brand'
import * as JsonlSessionPersistence from '../src/index.ts'
import type { JsonlRetentionReport } from '../src/index.ts'
import { logPath, sessionDir } from '../src/format.ts'

const failures = vi.hoisted(() => ({ rm: [] as Error[] }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    rm: async (...args: Parameters<typeof original.rm>) => {
      const failure = failures.rm.shift()
      if (failure !== undefined) throw failure
      return original.rm(...args)
    },
  }
})

interface Sweeping extends SessionPersistence {
  sweepRetention(options?: { now?: number }): Promise<JsonlRetentionReport>
}

const dirs: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  failures.rm.length = 0
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const EVENTS = [
  { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
  { type: 'turn/end', seq: SessionSeq(1), time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
] as const
const DAY = 86_400_000

function meta(id: string, extra: Partial<SessionHeader> = {}): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: brandString<SessionId>(id), createdAt: 1_000, cwd: '/work', isSeeded: false, ...extra }
}

async function mount(root: string, retention?: { maxAgeDays: number; intervalHours?: number }): Promise<Sweeping> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none', ...(retention === undefined ? {} : { retention }) })
  return ctx.sessionPersistence as Sweeping
}

async function seed(store: SessionPersistence, root: string, id: string, ageDays: number, extra: Partial<SessionHeader> = {}): Promise<void> {
  const handle = await store.create(meta(id, extra))
  await handle.append([...EVENTS])
  await handle.close()
  const when = new Date(Date.now() - ageDays * DAY)
  await utimes(logPath(root, '/work', brandString<SessionId>(id), 'none'), when, when)
}

const exists = (root: string, id: string): boolean => existsSync(sessionDir(root, '/work', brandString<SessionId>(id)))

describe('session retention', () => {
  it('deletes nothing by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-retention-'))
    dirs.push(root)
    const store = await mount(root)
    await seed(store, root, 'old', 400)
    await expect(store.sweepRetention()).resolves.toEqual({ deleted: [], skipped: [], failed: [] })
    expect(exists(root, 'old')).toBe(true)
  })

  it('deletes sessions whose log is older than maxAgeDays and keeps the rest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-retention-'))
    dirs.push(root)
    const store = await mount(root, { maxAgeDays: 30, intervalHours: 1000 })
    await seed(store, root, 'old', 90)
    await seed(store, root, 'recent', 1)
    const report = await store.sweepRetention()
    expect(report.deleted).toEqual([brandString<SessionId>('old')])
    expect(report.failed).toEqual([])
    expect(exists(root, 'old')).toBe(false)
    expect(exists(root, 'recent')).toBe(true)
  })

  it('sweeps once at mount without being asked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-retention-'))
    dirs.push(root)
    await seed(await mount(root), root, 'old', 90)
    await mount(root, { maxAgeDays: 30, intervalHours: 1000 })
    await vi.waitFor(() => { expect(exists(root, 'old')).toBe(false) })
  })

  it('skips a session a writer holds and a parent a surviving child still names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-retention-'))
    dirs.push(root)
    const store = await mount(root, { maxAgeDays: 30, intervalHours: 1000 })
    await seed(store, root, 'parent', 90)
    await seed(store, root, 'child', 1, { parentSession: brandString<SessionId>('parent') })
    await seed(store, root, 'busy', 90)
    const handle = await store.open(brandString<SessionId>('busy'))
    const report = await store.sweepRetention()
    expect(report.deleted).toEqual([])
    expect(report.skipped).toEqual(expect.arrayContaining([
      { id: 'parent', reason: 'referenced-by-child' },
      { id: 'busy', reason: 'in-use' },
    ]))
    expect(exists(root, 'parent')).toBe(true)
    expect(exists(root, 'busy')).toBe(true)
    await handle.close()
    const later = await store.sweepRetention()
    expect(later.deleted).toEqual([brandString<SessionId>('busy')])
  })

  it('reports a failed deletion, continues, and finishes on the next sweep', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-retention-'))
    dirs.push(root)
    const store = await mount(root, { maxAgeDays: 30, intervalHours: 1000 })
    await seed(store, root, 'a-old', 90)
    await seed(store, root, 'b-old', 90)
    failures.rm.push(new Error('disk went away'))
    const first = await store.sweepRetention()
    expect(first.failed).toHaveLength(1)
    expect(first.failed[0]!.message).toBe('disk went away')
    expect(first.deleted).toHaveLength(1)
    const remaining = ['a-old', 'b-old'].filter(id => exists(root, id))
    expect(remaining).toEqual([first.failed[0]!.id])
    const second = await store.sweepRetention()
    expect(second.deleted).toEqual(remaining.map(id => brandString<SessionId>(id)))
    expect(second.failed).toEqual([])
  })
})
