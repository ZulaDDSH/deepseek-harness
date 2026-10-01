import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { memorixInventory, memorixPage } from '../src/memorix-store.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-memorix-browser-'))
  directories.push(directory)
  const path = join(directory, 'memorix.db')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY); CREATE TABLE observations(id INTEGER PRIMARY KEY, title TEXT, projectId TEXT, status TEXT); CREATE TABLE long_term_memories(id TEXT, content TEXT)')
  for (const id of [
    '1.2-code-state-snapshots', '1.2-knowledge-claim-ledger', '1.2-knowledge-workspace',
    '1.2-workflow-inheritance', '1.2.2-observation-admission', '1.2.2-observation-visibility',
    '1.2.7-compaction-checkpoints', '1.3-long-term-memory',
  ]) db.prepare('INSERT INTO schema_migrations VALUES (?)').run(id)
  db.prepare('INSERT INTO observations VALUES (?, ?, ?, ?)').run(1, '100% documented', 'project-a', 'active')
  db.prepare('INSERT INTO observations VALUES (?, ?, ?, ?)').run(2, 'archived decision', 'project-b', 'archived')
  db.close()
  return path
}

describe('Memorix read-only browsing', () => {
  it('enumerates provider records across projects and statuses without altering the database', async () => {
    const path = await fixture()
    const before = await readFile(path)
    expect(memorixInventory(path)).toContainEqual({ name: 'observations', columns: ['id', 'title', 'projectId', 'status'], count: 2 })
    const first = memorixPage(path, { table: 'observations', limit: 1, offset: 0, query: '' })
    expect(first.total).toBe(2)
    expect(first.rows).toEqual([{ id: '1', title: '100% documented', projectId: 'project-a', status: 'active' }])
    expect(memorixPage(path, { table: 'observations', limit: 1, offset: 1, query: '' }).rows[0]?.status).toBe('archived')
    expect(memorixPage(path, { table: 'long_term_memories', limit: 1, offset: 0, query: '' }).total).toBe(0)
    expect(await readFile(path)).toEqual(before)
  })

  it('searches the complete table and treats wildcard input literally', async () => {
    const path = await fixture()
    expect(memorixPage(path, { table: 'observations', limit: 1, offset: 0, query: '%' }).total).toBe(1)
    expect(memorixPage(path, { table: 'observations', limit: 1, offset: 0, query: 'project-b' }).rows[0]?.id).toBe('2')
  })

  it('rejects absent tables, invalid pagination, SQL text and unknown provider migrations', async () => {
    const path = await fixture()
    const request = { table: 'observations', limit: 1, offset: 0, query: '' }
    for (const change of [{ table: 'missing' }, { table: 'observations;DROP TABLE observations' }, { limit: 0 }, { offset: -1 }]) {
      expect(() => memorixPage(path, { ...request, ...change })).toThrow()
    }
    const db = new DatabaseSync(path)
    db.exec("INSERT INTO schema_migrations VALUES ('future-layout')")
    db.close()
    expect(() => memorixInventory(path)).toThrow('Unsupported Memorix schema')
  })
})
