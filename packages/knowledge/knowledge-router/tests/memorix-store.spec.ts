import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { memorixInventory, memorixObservations, memorixPage, memorixRecent, memorixStoredChunk } from '../src/memorix-store.ts'

const MEMORIX_1_3_0 = [
  '1.2-code-state-snapshots', '1.2-knowledge-claim-ledger', '1.2-knowledge-workspace',
  '1.2-workflow-inheritance', '1.2.2-observation-admission', '1.2.2-observation-visibility',
  '1.2.7-compaction-checkpoints', '1.3-long-term-memory',
]
const MEMORIX_1_9_10_EXTRA = [
  '1.2-observation-attachments', '1.3.3-media-assets', '1.4-codegraph-snapshot-manifest', '1.4-memory-outcome-signals',
  '1.4.3-media-derivation-metadata', '1.4.3-media-job-source-asset', '1.8-context-control-plane', '1.8.7-codegraph-evidence', '1.9-continuity-v2',
]

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-memorix-browser-'))
  directories.push(directory)
  const path = join(directory, 'memorix.db')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY); CREATE TABLE observations(id INTEGER PRIMARY KEY, title TEXT, projectId TEXT, status TEXT); CREATE TABLE long_term_memories(id TEXT, content TEXT)')
  for (const id of MEMORIX_1_3_0) db.prepare('INSERT INTO schema_migrations VALUES (?)').run(id)
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
    expect(first.rows).toEqual([{ id: '2', title: 'archived decision', projectId: 'project-b', status: 'archived' }])
    expect(memorixPage(path, { table: 'observations', limit: 1, offset: 1, query: '' }).rows[0]?.status).toBe('active')
    expect(memorixPage(path, { table: 'long_term_memories', limit: 1, offset: 0, query: '' }).total).toBe(0)
    expect(await readFile(path)).toEqual(before)
  })

  it('encodes BLOB columns as base64', async () => {
    const path = await fixture()
    const db = new DatabaseSync(path)
    db.exec('CREATE TABLE attachments(id INTEGER, payload BLOB)')
    db.prepare('INSERT INTO attachments VALUES (?, ?)').run(1, new Uint8Array([1, 2, 255]))
    db.close()
    expect(memorixPage(path, { table: 'attachments', limit: 1, offset: 0, query: '' }).rows)
      .toEqual([{ id: '1', payload: { base64: 'AQL/' } }])
  })

  it('searches the complete table and treats wildcard input literally', async () => {
    const path = await fixture()
    expect(memorixPage(path, { table: 'observations', limit: 1, offset: 0, query: '%' }).total).toBe(1)
    expect(memorixPage(path, { table: 'observations', limit: 1, offset: 0, query: 'project-b' }).rows[0]?.id).toBe('2')
  })

  it('lists the newest record first so recent memories are not buried behind imported history', async () => {
    const path = await fixture()
    const db = new DatabaseSync(path)
    for (let id = 3; id <= 120; id++) db.prepare('INSERT INTO observations VALUES (?, ?, ?, ?)').run(id, `memory ${id}`, 'project-a', 'active')
    db.close()
    const page = memorixPage(path, { table: 'observations', limit: 3, offset: 0, query: '' })
    expect(page.rows.map(row => row.id)).toEqual(['120', '119', '118'])
    expect(memorixPage(path, { table: 'observations', limit: 3, offset: 3, query: '' }).rows[0]?.id).toBe('117')
  })

  it('separates imported document chunks from saved memories and combines the filter with search', async () => {
    const path = await fixture()
    const db = new DatabaseSync(path)
    db.exec('ALTER TABLE observations ADD COLUMN topicKey TEXT')
    db.prepare('INSERT INTO observations VALUES (?, ?, ?, ?, ?)').run(10, 'guide (1/2)', 'p', 'active', 'document:abc:part:1')
    db.prepare('INSERT INTO observations VALUES (?, ?, ?, ?, ?)').run(11, 'guide (2/2)', 'p', 'active', 'document:abc:part:2')
    db.prepare('INSERT INTO observations VALUES (?, ?, ?, ?, ?)').run(12, 'agent memory', 'p', 'active', 'dsh-session:1')
    db.close()
    const ids = (view: 'all' | 'memories' | 'documents', query = ''): string[] =>
      memorixPage(path, { table: 'observations', limit: 10, offset: 0, query, view }).rows.map(row => typeof row.id === 'string' ? row.id : JSON.stringify(row.id))
    expect(ids('all')).toEqual(['12', '11', '10', '2', '1'])
    expect(ids('documents')).toEqual(['11', '10'])
    expect(ids('memories')).toEqual(['12', '2', '1'])
    expect(ids('documents', 'guide (2')).toEqual(['11'])
    expect(memorixPage(path, { table: 'observations', limit: 10, offset: 0, query: '', view: 'documents' }).total).toBe(2)
    expect(memorixPage(path, { table: 'long_term_memories', limit: 1, offset: 0, query: '', view: 'documents' }).total).toBe(0)
  })

  it('names the missing database path and the migration difference instead of a bare driver error', async () => {
    const path = await fixture()
    expect(() => memorixInventory(`${path}.absent`)).toThrow(/Memorix database not found at .*absent.*MEMORIX_DATA_DIR.*databasePath/)
    const db = new DatabaseSync(path)
    db.exec("DELETE FROM schema_migrations WHERE id = '1.3-long-term-memory'; INSERT INTO schema_migrations VALUES ('1.4-future')")
    db.close()
    expect(() => memorixInventory(path)).toThrow('Unsupported Memorix database: missing schema migrations 1.3-long-term-memory.')
    const plain = join(path, '..', 'plain.db')
    const other = new DatabaseSync(plain)
    other.exec('CREATE TABLE notes(id INTEGER)')
    other.close()
    expect(() => memorixInventory(plain)).toThrow('The file is not a Memorix database')
  })

  it('accepts provider table names with digits instead of failing the whole inventory', async () => {
    const path = await fixture()
    const db = new DatabaseSync(path)
    db.exec('CREATE TABLE memories_v2(id INTEGER, body TEXT)')
    db.prepare('INSERT INTO memories_v2 VALUES (?, ?)').run(1, 'kept')
    db.close()
    expect(memorixInventory(path).map(table => table.name)).toContain('memories_v2')
    expect(memorixPage(path, { table: 'memories_v2', limit: 5, offset: 0, query: 'kept' }).total).toBe(1)
  })

  it('reads the newest active observations of one entity before a bound, leaving a topic prefix out', async () => {
    const path = await fixture()
    const db = new DatabaseSync(path)
    db.exec('DROP TABLE observations; CREATE TABLE observations(id INTEGER PRIMARY KEY, entityName TEXT, projectId TEXT, title TEXT, narrative TEXT, topicKey TEXT, status TEXT, createdAt TEXT)')
    const insert = db.prepare('INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    insert.run(1, 'ws', 'p', 'old', 'oldest', 'dsh-session:a:1', 'active', '2026-01-01T00:00:00.000Z')
    insert.run(2, 'ws', 'p', 'mid', 'middle', 'dsh-session:b:1', 'active', '2026-02-01T00:00:00.000Z')
    insert.run(3, 'ws', 'p', 'self', 'own', 'dsh-session:c:1', 'active', '2026-02-15T00:00:00.000Z')
    insert.run(4, 'ws', 'p', 'late', 'after', 'dsh-session:d:1', 'active', '2026-04-01T00:00:00.000Z')
    insert.run(5, 'other', 'p', 'elsewhere', 'x', 'dsh-session:e:1', 'active', '2026-02-01T00:00:00.000Z')
    insert.run(6, 'ws', 'p', 'gone', 'x', 'dsh-session:f:1', 'archived', '2026-02-02T00:00:00.000Z')
    db.close()
    const query = { entityName: 'ws', excludeTopicPrefix: 'dsh-session:c:', before: '2026-03-01T00:00:00.000Z', limit: 5 }
    expect(memorixRecent(path, query).map(row => row.title)).toEqual(['mid', 'old'])
    expect(memorixRecent(path, { ...query, limit: 1 })).toHaveLength(1)
  })

  it('accepts the 1.3.0 and 1.9.10 migration sets and tolerates migrations it does not know', async () => {
    const path = await fixture()
    const db = new DatabaseSync(path)
    for (const id of [...MEMORIX_1_9_10_EXTRA, 'future-layout']) db.prepare('INSERT INTO schema_migrations VALUES (?)').run(id)
    db.close()
    expect(memorixInventory(path).map(table => table.name)).toContain('observations')
    const removed = new DatabaseSync(path)
    removed.exec("DELETE FROM schema_migrations WHERE id = '1.2-workflow-inheritance'")
    removed.close()
    expect(() => memorixInventory(path)).toThrow('missing schema migrations 1.2-workflow-inheritance')
  })

  it('reads observations by identifier in request order and names a database lacking the observation columns', async () => {
    const path = await fixture()
    const db = new DatabaseSync(path)
    db.exec('DROP TABLE observations; CREATE TABLE observations(id INTEGER PRIMARY KEY, entityName TEXT, projectId TEXT, title TEXT, narrative TEXT, topicKey TEXT, status TEXT, createdAt TEXT)')
    db.prepare('INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(7, 'ws', 'p', 'seven', 'seven body', 'dsh-session:x:1', 'active', '2026-03-01T00:00:00.000Z')
    db.prepare('INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(8, 'ws', 'p', 'eight', 'eight body', null, 'active', '2026-03-02T00:00:00.000Z')
    db.close()
    expect(memorixObservations(path, [8, 99, 7]).map(row => row.title)).toEqual(['eight', 'seven'])
    expect(memorixObservations(path, [])).toEqual([])
    expect(memorixStoredChunk(path, 7, 'p', 'dsh-session:x:1', 'seven body')).toBe(true)
    const narrow = join(path, '..', 'narrow.db')
    const other = new DatabaseSync(narrow)
    other.exec(`CREATE TABLE schema_migrations(id TEXT PRIMARY KEY); CREATE TABLE observations(id INTEGER PRIMARY KEY, title TEXT);${MEMORIX_1_3_0.map(id => ` INSERT INTO schema_migrations VALUES ('${id}');`).join('')}`)
    other.close()
    expect(() => memorixObservations(narrow, [1])).toThrow('the observations table lacks entityName')
  })

  it('rejects absent tables, invalid pagination and SQL text', async () => {
    const path = await fixture()
    const request = { table: 'observations', limit: 1, offset: 0, query: '' }
    for (const change of [{ table: 'missing' }, { table: 'observations;DROP TABLE observations' }, { limit: 0 }, { offset: -1 }]) {
      expect(() => memorixPage(path, { ...request, ...change })).toThrow()
    }
  })
})
