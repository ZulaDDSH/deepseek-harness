import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionSeq, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError, SessionPersistenceNotFoundError, type SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { brandString } from '@deepseek-ai/dsh-brand'
import * as JsonlSessionPersistence from '../src/index.ts'
import { sessionDir } from '../src/format.ts'

interface Deleting { deleteSession(id: SessionId): Promise<void> }

const dirs: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const EVENTS = [
  { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
  { type: 'turn/end', seq: SessionSeq(1), time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
] as const

function meta(id: string): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: brandString<SessionId>(id), createdAt: 1_000, cwd: '/work', isSeeded: false }
}

async function mount(root: string): Promise<SessionPersistence & Deleting> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return ctx.sessionPersistence as SessionPersistence & Deleting
}

describe('session deletion', () => {
  it('removes a closed session and its directory, leaving others alone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-delete-'))
    dirs.push(root)
    const store = await mount(root)
    for (const id of ['gone', 'kept']) {
      const handle = await store.create(meta(id))
      await handle.append([...EVENTS])
      await handle.close()
    }
    const id = brandString<SessionId>('gone')
    expect(existsSync(sessionDir(root, '/work', id))).toBe(true)

    await store.deleteSession(id)

    expect(existsSync(sessionDir(root, '/work', id))).toBe(false)
    expect(await store.stat(id)).toBeUndefined()
    expect((await store.list()).map(snapshot => snapshot.header.id)).toEqual([brandString<SessionId>('kept')])
    await expect(store.deleteSession(id)).rejects.toBeInstanceOf(SessionPersistenceNotFoundError)
  })

  it('refuses while a writer in this or another instance holds the session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-delete-'))
    dirs.push(root)
    const first = await mount(root)
    const second = await mount(root)
    const handle = await first.create(meta('busy'))
    await handle.append([...EVENTS])
    const id = brandString<SessionId>('busy')

    await expect(first.deleteSession(id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    await expect(second.deleteSession(id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    expect(existsSync(sessionDir(root, '/work', id))).toBe(true)

    await handle.close()
    await second.deleteSession(id)
    expect(existsSync(sessionDir(root, '/work', id))).toBe(false)
  })
})
