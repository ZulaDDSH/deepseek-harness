/** @module Read-only browsing of the Memorix 1.3.0 SQLite store. */
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import { z } from 'zod'
import type { MemorixCell, MemorixPage, MemorixTable } from './types.ts'

const MIGRATIONS = [
  '1.2-code-state-snapshots', '1.2-knowledge-claim-ledger', '1.2-knowledge-workspace',
  '1.2-workflow-inheritance', '1.2.2-observation-admission', '1.2.2-observation-visibility',
  '1.2.7-compaction-checkpoints', '1.3-long-term-memory',
].sort()
const Request = z.object({
  table: z.string().regex(/^[a-z_]+$/),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  query: z.string(),
})


function cell(value: SQLOutputValue): MemorixCell {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return { base64: Buffer.from(value).toString('base64') }
  return value
}

function tables(db: DatabaseSync): MemorixTable[] {
  const migrations = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(row => row.id)
  if (JSON.stringify(migrations) !== JSON.stringify(MIGRATIONS)) throw new Error('Unsupported Memorix schema; expected Memorix 1.3.0 migrations')
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  return names.map((row) => {
    const name = z.string().regex(/^[a-z_]+$/).parse(row.name)
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map(column => z.string().parse(column.name))
    const count = z.number().int().nonnegative().parse(db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get()?.n)
    return { name, columns, count }
  })
}

function read<T>(path: string, operation: (db: DatabaseSync) => T): T {
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
 * @param request - table, offset, positive page limit and literal search text.
 * @returns records and matching count from one read transaction; no rows are silently dropped.
 * @throws for invalid input, absent tables, unsupported migrations or database read errors.
 */
export function memorixPage(path: string, request: { table: string; offset: number; limit: number; query: string }): MemorixPage {
  const input = Request.parse(request)
  return read(path, (db) => {
    const table = tables(db).find(item => item.name === input.table)
    if (table === undefined) throw new Error('Unknown Memorix table')
    const escaped = input.query.replace(/[\\%_]/g, '\\$&')
    const condition = input.query === '' ? '' : ` WHERE ${table.columns.map(column => `CAST("${column.replaceAll('"', '""')}" AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ')}`
    const parameters = input.query === '' ? [] : table.columns.map(() => `%${escaped}%`)
    const total = z.number().int().nonnegative().parse(db.prepare(`SELECT COUNT(*) AS n FROM "${table.name}"${condition}`).get(...parameters)?.n)
    const statement = db.prepare(`SELECT * FROM "${table.name}"${condition} ORDER BY rowid LIMIT ? OFFSET ?`)
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
    tables(db)
    const row = db.prepare('SELECT projectId, topicKey, narrative FROM observations WHERE id = ?').get(id)
    return row?.projectId === project && row.topicKey === topic && row.narrative === narrative
  })
}
