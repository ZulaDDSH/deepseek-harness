import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHumanOperations } from '../../../mcp/mcp-client/src/human-operations.ts'
import MemoryWorkspace from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-native-command', () => ({ runNativeCommand: vi.fn(async () => ({ stdout: '', stderr: '' })) }))

const roots: Context[] = [], directories: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function setup(persist = true): Promise<{ ctx: Context; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-memory-workspace-'))
  directories.push(directory)
  const db = new DatabaseSync(join(directory, 'memorix.db'))
  db.exec("CREATE TABLE schema_migrations(id TEXT PRIMARY KEY); CREATE TABLE observations(id INTEGER PRIMARY KEY, title TEXT, narrative TEXT, topicKey TEXT UNIQUE, projectId TEXT DEFAULT 'fixture')")
  for (const id of [
    '1.2-code-state-snapshots', '1.2-knowledge-claim-ledger', '1.2-knowledge-workspace',
    '1.2-workflow-inheritance', '1.2.2-observation-admission', '1.2.2-observation-visibility',
    '1.2.7-compaction-checkpoints', '1.3-long-term-memory',
  ]) db.prepare('INSERT INTO schema_migrations VALUES (?)').run(id)
  const ctx = new Context()
  roots.push(ctx)
  ctx.effect(() => () => { db.close() })
  registerHumanOperations(ctx, 'memorix', {
    local: true, cwd: directory, env: { MEMORIX_DATA_DIR: directory },
    call: async (name, args) => {
      expect(name).toBe('memorix_store')
      if (persist) db.prepare('INSERT INTO observations(title, narrative, topicKey) VALUES (?, ?, ?) ON CONFLICT(topicKey) DO UPDATE SET narrative=excluded.narrative').run(
        z.string().parse(args.title), z.string().parse(args.narrative), z.string().parse(args.topicKey))
      const stored = db.prepare('SELECT id FROM observations WHERE topicKey = ?').get(z.string().parse(args.topicKey))
      return { content: [{ type: 'text', text: `[OK] Stored observation #${stored?.id ?? 999} "title" (~1 tokens)\nEntity: document | Type: discovery | Project: fixture | Topic: ${z.string().parse(args.topicKey)}` }] }
    },
  })
  await ctx.plugin(MemoryWorkspace, { chunkCharacters: 3, importDirectory: join(directory, 'documents') })
  return { ctx, directory }
}

describe('Memory workspace', () => {
  it('uses the connected provider storage and verifies every document chunk and retry', async () => {
    const { ctx } = await setup()
    const text = 'full😀 document'
    const result = await ctx.memoryWorkspace.importDocument('../guide.md', Buffer.from(text).toString('base64'))
    expect(result).toMatchObject({ completed: 5, total: 5, error: null })
    expect(await readFile(result.originalPath, 'utf8')).toBe(text)
    expect((await ctx.memoryWorkspace.page('observations', 0, '')).total).toBe(5)
    expect((await ctx.memoryWorkspace.importDocument('guide.md', Buffer.from(text).toString('base64'))).completed).toBe(5)
    expect((await ctx.memoryWorkspace.page('observations', 0, '')).total).toBe(5)
  })

  it('reports a failed read-back without claiming import success', async () => {
    const { ctx } = await setup(false)
    expect(await ctx.memoryWorkspace.importDocument('guide.txt', Buffer.from('data').toString('base64'))).toMatchObject({
      completed: 0, total: 2, error: 'Memorix did not persist the complete document chunk',
    })
  })

  it('loads the complete official viewer and rejects oversized exports', async () => {
    const { ctx, directory } = await setup()
    const graphPath = join(directory, 'graph.json')
    await writeFile(graphPath, JSON.stringify({ nodes: [{ id: 'a', label: 'Guide', source_file: 'guide.md' }, { id: 'b' }], links: [{ source: 'a', target: 'b', relation: 'references' }] }))
    const graphCtx = new Context()
    roots.push(graphCtx)
    registerHumanOperations(graphCtx, 'memorix', { local: true, cwd: directory, env: {}, call: async () => ({}) })
    await graphCtx.plugin(MemoryWorkspace, { graphPath, maxGraphBytes: 512 })
    const html = '<html><body>Graphify communities</body></html>'
    await writeFile(join(directory, 'graph.html'), html)
    const graph = await graphCtx.memoryWorkspace.graph()
    expect(graph.html).toBe(html)
    expect(graph.path).toBe(graphPath)
    await writeFile(graphPath, 'x'.repeat(513))
    await expect(graphCtx.memoryWorkspace.graph()).rejects.toThrow('configured byte limit')
    await expect(ctx.memoryWorkspace.importDocument('empty.txt', Buffer.from(' ').toString('base64'))).rejects.toThrow('no extractable text')
  })
})
