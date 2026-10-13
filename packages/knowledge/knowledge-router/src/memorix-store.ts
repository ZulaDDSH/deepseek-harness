/** @module Read-only browsing of the Memorix 1.3.0 SQLite store. */
import { existsSync } from 'node:fs'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import { z } from 'zod'
import type { MemorixCell, MemorixPage, MemorixRecentObservation, MemorixTable, MemorixView } from './types.ts'

const MIGRATIONS = [
  '1.2-code-state-snapshots', '1.2-knowledge-claim-ledger', '1.2-knowledge-workspace',
  '1.2-workflow-inheritance', '1.2.2-observation-admission', '1.2.2-observation-visibility',
  '1.2.7-compaction-checkpoints', '1.3-long-term-memory',
].sort()
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const DOCUMENT_TOPIC = "topicKey LIKE 'document:%'"
const Request = z.object({
  table: z.string().regex(IDENTIFIER),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  query: z.string(),
  view: z.enum(['all', 'memories', 'documents']).default('all'),
})


function cell(value: SQLOutputValue): MemorixCell {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return { base64: Buffer.from(value).toString('base64') }
  return value
}

function tables(db: DatabaseSync, only?: string): MemorixTable[] {
  let migrations: string[]
  try { migrations = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(row => String(row.id)) }
  catch { throw new Error('The file is not a Memorix 1.3.0 database (it has no schema_migrations table)') }
  if (JSON.stringify(migrations) !== JSON.stringify(MIGRATIONS)) {
    const missing = MIGRATIONS.filter(id => !migrations.includes(id))
    const unexpected = migrations.filter(id => !MIGRATIONS.includes(id))
    throw new Error('Unsupported Memorix schema: this panel reads only the Memorix 1.3.0 database layout'
      + (missing.length > 0 ? `; missing migrations: ${missing.join(', ')}` : '')
      + (unexpected.length > 0 ? `; unrecognized migrations: ${unexpected.join(', ')}` : '')
      + '. Install memorix@1.3.0 or point databasePath at a 1.3.0 database.')
  }
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  return names.filter(row => only === undefined || row.name === only).map((row) => {
    const name = z.string().regex(IDENTIFIER).parse(row.name)
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map(column => z.string().parse(column.name))
    const count = z.number().int().nonnegative().parse(db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get()?.n)
    return { name, columns, count }
  })
}

function read<T>(path: string, operation: (db: DatabaseSync) => T): T {
  if (!existsSync(path)) {
    throw new Error(`Memorix database not found at ${path}. Memorix creates it when the first memory is stored; `
      + 'if it keeps its data elsewhere, set MEMORIX_DATA_DIR on the Memorix MCP client or databasePath on ui-memory-workspace.')
  }
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('BEGIN')
    return operation(db)
  } finally {
    db.close()
  }
}

/**
 * List every table and record count without provider initialization or migrations.
 * @param path - configured Memorix database path, shared with the MCP server.
 * @returns inventory including memories, skills, graphs, knowledge and coordination records.
 * @throws for a missing database or unsupported migration inventory.
 */
export function memorixInventory(path: string): MemorixTable[] {
  return read(path, tables)
}

/**
 * Read one bounded page, searching all columns with literal substring matching.
 * @param path - configured Memorix database path.
 * @param request - table, offset, positive page limit, literal search text and optional document filter.
 * @returns newest-first records and matching count from one read transaction; no rows are silently dropped.
 * @throws for invalid input, absent tables, unsupported migrations or database read errors.
 */
export function memorixPage(path: string, request: {
  table: string
  offset: number
  limit: number
  query: string
  view?: MemorixView
}): MemorixPage {
  const input = Request.parse(request)
  return read(path, (db) => {
    const table = tables(db, input.table).find(item => item.name === input.table)
    if (table === undefined) throw new Error(`Unknown Memorix table "${input.table}"`)
    const escaped = input.query.replace(/[\\%_]/g, '\\$&')
    const clauses: string[] = []
    if (input.query !== '') clauses.push(`(${table.columns.map(column => `CAST("${column.replaceAll('"', '""')}" AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ')})`)
    if (input.view !== 'all' && table.columns.includes('topicKey')) {
      clauses.push(input.view === 'documents' ? DOCUMENT_TOPIC : `(topicKey IS NULL OR NOT ${DOCUMENT_TOPIC})`)
    }
    const condition = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    const parameters = input.query === '' ? [] : table.columns.map(() => `%${escaped}%`)
    const total = z.number().int().nonnegative().parse(db.prepare(`SELECT COUNT(*) AS n FROM "${table.name}"${condition}`).get(...parameters)?.n)
    const statement = db.prepare(`SELECT * FROM "${table.name}"${condition} ORDER BY rowid DESC LIMIT ? OFFSET ?`)
    statement.setReadBigInts(true)
    const rows = statement.all(...parameters, input.limit, input.offset).map(row =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cell(value)])))
    return { table: table.name, columns: table.columns, rows, total, offset: input.offset, limit: input.limit }
  })
}

/**
 * Verify the exact observation acknowledged by the connected Memorix server.
 * @param path - provider database path.
 * @param id - acknowledged numeric observation identifier.
 * @param project - acknowledged project identifier.
 * @param topic - submitted topic key.
 * @param narrative - complete submitted text.
 * @returns whether that exact stored observation contains the complete chunk.
 */
export function memorixStoredChunk(path: string, id: number, project: string, topic: string, narrative: string): boolean {
  z.number().int().positive().parse(id)
  return read(path, (db) => {
    tables(db, 'observations')
    const row = db.prepare('SELECT projectId, topicKey, narrative FROM observations WHERE id = ?').get(id)
    return row?.projectId === project && row.topicKey === topic && row.narrative === narrative
  })
}

/**
 * Read the newest saved observations of one entity created before a point in time.
 * @param path - provider database path.
 * @param query - entity name, topic-key prefix to leave out, exclusive creation bound and positive row limit.
 * @returns active observations newest first; empty when none match.
 */
export function memorixRecent(path: string, query: {
  entityName: string
  excludeTopicPrefix: string
  before: string
  limit: number
}): MemorixRecentObservation[] {
  const input = z.object({
    entityName: z.string().min(1),
    excludeTopicPrefix: z.string(),
    before: z.string().min(1),
    limit: z.number().int().positive(),
  }).parse(query)
  return read(path, (db) => {
    tables(db, 'observations')
    const escaped = input.excludeTopicPrefix.replace(/[\\%_]/g, '\\$&')
    return db.prepare(
      "SELECT title, narrative, createdAt FROM observations WHERE entityName = ? AND status = 'active' AND createdAt < ? "
      + "AND (topicKey IS NULL OR topicKey NOT LIKE ? ESCAPE '\\') ORDER BY createdAt DESC, id DESC LIMIT ?",
    ).all(input.entityName, input.before, `${escaped}%`, input.limit).map(row => ({
      title: z.string().parse(row.title), narrative: z.string().parse(row.narrative), createdAt: z.string().parse(row.createdAt),
    }))
  })
}
