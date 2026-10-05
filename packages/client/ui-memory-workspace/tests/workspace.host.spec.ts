import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { registerHumanOperations, type McpHumanOperations } from '../../../mcp/mcp-client/src/human-operations.ts'
import MemoryWorkspace, { type Config } from '../src/index.ts'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionToken, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'

vi.mock('@deepseek-ai/dsh-native-command', () => ({ runNativeCommand: vi.fn(async () => ({ stdout: '', stderr: '' })) }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, writeFile: vi.fn(original.writeFile) }
})

const roots: Context[] = [], directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-memory-workspace-'))
  directories.push(directory)
  return directory
}

function createDatabase(directory: string): DatabaseSync {
  const db = new DatabaseSync(join(directory, 'memorix.db'))
  db.exec("CREATE TABLE schema_migrations(id TEXT PRIMARY KEY); CREATE TABLE observations(id INTEGER PRIMARY KEY, title TEXT, narrative TEXT, topicKey TEXT UNIQUE, projectId TEXT DEFAULT 'fixture')")
  for (const id of [
    '1.2-code-state-snapshots', '1.2-knowledge-claim-ledger', '1.2-knowledge-workspace',
    '1.2-workflow-inheritance', '1.2.2-observation-admission', '1.2.2-observation-visibility',
    '1.2.7-compaction-checkpoints', '1.3-long-term-memory',
  ]) db.prepare('INSERT INTO schema_migrations VALUES (?)').run(id)
  return db
}

async function connect(config: Partial<Config>, provider?: McpHumanOperations): Promise<Context> {
  const ctx = new Context()
  roots.push(ctx)
  if (provider !== undefined) registerHumanOperations(ctx, 'memorix', provider)
  await ctx.plugin(MemoryWorkspace, config)
  return ctx
}

const localProvider = (directory: string, call: McpHumanOperations['call'] = async () => ({})): McpHumanOperations =>
  ({ local: true, cwd: directory, env: { MEMORIX_DATA_DIR: directory }, call })
const encode = (text: string): string => Buffer.from(text).toString('base64')

function refused(reason: string): Promise<never> {
  const settled = Promise.withResolvers<never>()
  settled.reject(reason)
  return settled.promise
}

async function setup(persist = true): Promise<{ ctx: Context; directory: string }> {
  const directory = await temporary()
  const db = createDatabase(directory)
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
  it('imports a workspace-relative file through the registered agent tool and honors cancellation', async () => {
    const { ctx, directory } = await setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem)
    await writeFile(join(directory, 'guide.md'), 'café😀 memory')
    const tool = ctx.tools.get('memorix_import_file')
    expect(tool).toBeDefined()
    const agent = { session: { header: { cwd: directory } } } as Agent
    const signal = new AbortController().signal
    const callId = ToolCallId('memory-file-import')
    const exec: ToolRunContext = {
      callId, rootCallId: callId, token: Symbol('memory-file-import') as ToolExecutionToken,
      name: 'memorix_import_file', arguments: { path: 'guide.md' }, signal, agent,
      deferContext: () => {}, concludeTurn: () => {},
    }
    const result = await tool!.execute(exec.arguments, exec)
    const saved = JSON.parse(String(result)) as Record<string, unknown>
    expect(tool!.output.render({ path: 'guide.md' }, JSON.stringify({ ...saved, originalPath: '<retained original>' }))).toMatchInlineSnapshot(`
      [
        {
          "text": "{\"filename\":\"guide.md\",\"originalPath\":\"<retained original>\",\"completed\":4,\"total\":4,\"error\":null}",
          "type": "text",
        },
      ]
    `)
    expect(saved).toMatchObject({ filename: 'guide.md', completed: 4, total: 4, error: null })
    expect((await ctx.memoryWorkspace.page('observations', 0, '')).total).toBe(4)
    const aborted = AbortSignal.abort()
    await expect(tool!.execute({ path: 'guide.md' }, { ...exec, signal: aborted })).rejects.toThrow()
    const unowned = { ...exec }
    delete unowned.agent
    await expect(tool!.execute({ path: 'guide.md' }, unowned)).rejects.toThrow('requires a chat workspace')
  })

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
    registerHumanOperations(graphCtx, 'memorix', { local: true, cwd: directory, env: { MEMORIX_DATA_DIR: directory }, call: async () => ({}) })
    await graphCtx.plugin(MemoryWorkspace, { graphPath, maxGraphBytes: 512 })
    const html = '<html><body>Graphify communities</body></html>'
    await writeFile(join(directory, 'graph.html'), html)
    const graph = await graphCtx.memoryWorkspace.graph()
    expect(graph.html).toBe(html)
    expect(graph.path).toBe(graphPath)
    expect(runNativeCommand).toHaveBeenLastCalledWith('graphify', [
      'memorix', '--database', join(directory, 'memorix.db'), '--graph', graphPath,
    ], expect.any(AbortSignal), 'hidden')
    await writeFile(graphPath, 'x'.repeat(513))
    await expect(graphCtx.memoryWorkspace.graph()).rejects.toThrow('configured byte limit')
    await expect(ctx.memoryWorkspace.importDocument('empty.txt', Buffer.from(' ').toString('base64'))).rejects.toThrow('no extractable text')
  })
})

describe('Memory workspace provider access', () => {
  it('requires a connected provider and a database path it can resolve', async () => {
    const directory = await temporary()
    await expect((await connect({})).memoryWorkspace.inventory()).rejects.toThrow('Memorix is not connected')
    const remote = await connect({}, { ...localProvider(directory), local: false })
    await expect(remote.memoryWorkspace.inventory()).rejects.toThrow('explicit local database path')
  })

  it('browses an explicit database for a remote provider', async () => {
    const directory = await temporary()
    createDatabase(directory).close()
    const remote = await connect({ databasePath: join(directory, 'memorix.db') }, { ...localProvider(directory), local: false, cwd: '', env: {} })
    expect((await remote.memoryWorkspace.inventory()).map(table => table.name)).toContain('observations')
  })

  it('falls back to the home data directory when the provider names none', async () => {
    const home = await temporary()
    const data = join(home, '.memorix', 'data')
    await mkdir(data, { recursive: true })
    createDatabase(data).close()
    vi.stubEnv('HOME', home)
    vi.stubEnv('USERPROFILE', home)
    const ctx = await connect({}, { ...localProvider(home), cwd: '', env: {} })
    expect((await ctx.memoryWorkspace.inventory()).map(table => table.name)).toContain('observations')
  })

  it('serves the default graph location and recovers after a failed rebuild', async () => {
    const directory = await temporary()
    createDatabase(directory).close()
    const imports = join(directory, 'imports')
    const ctx = await connect({ importDirectory: imports }, localProvider(directory))
    await expect(ctx.memoryWorkspace.graph()).rejects.toThrow()
    const output = join(imports, 'graphify-out')
    await mkdir(output, { recursive: true })
    await writeFile(join(output, 'graph.json'), '{}')
    await writeFile(join(output, 'graph.html'), '<html></html>')
    expect(await ctx.memoryWorkspace.graph()).toEqual({ path: resolve(output, 'graph.json'), html: '<html></html>' })
  })
})

describe('Memory workspace import safeguards', () => {
  it('rejects uploads that are not canonical, empty or too large', async () => {
    const directory = await temporary()
    const ctx = await connect({ maxDocumentBytes: 5 }, localProvider(directory))
    await expect(ctx.memoryWorkspace.importDocument('a.md', 'AB')).rejects.toThrow('not canonical base64')
    await expect(ctx.memoryWorkspace.importDocument('a.md', '')).rejects.toThrow('byte limit or is empty')
    await expect(ctx.memoryWorkspace.importDocument('a.md', encode('abcdef'))).rejects.toThrow('byte limit or is empty')
  })

  it('refuses a retained original whose content differs and surfaces other storage failures', async () => {
    const { ctx, directory } = await setup()
    const hash = createHash('sha256').update('tail').digest('hex')
    await mkdir(join(directory, 'documents'), { recursive: true })
    await writeFile(join(directory, 'documents', `${hash}.md`), 'different')
    await expect(ctx.memoryWorkspace.importDocument('a.md', encode('tail'))).rejects.toThrow('does not match its identifier')
    vi.mocked(writeFile).mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
    await expect(ctx.memoryWorkspace.importDocument('b.md', encode('other'))).rejects.toThrow('disk full')
  })

  it.each([
    ['a refused chunk', async () => ({ isError: true, content: [] }), 'Memorix rejected this document chunk'],
    ['an acknowledgement without text', async () => ({ content: [{ type: 'text' }] }), 'Memorix did not persist the complete document chunk'],
    ['a non-Error rejection', () => refused('refused'), 'Document import failed'],
  ])('reports %s without claiming success', async (_name, call, error) => {
    const directory = await temporary()
    const ctx = await connect({ importDirectory: join(directory, 'documents') }, localProvider(directory, call))
    expect(await ctx.memoryWorkspace.importDocument('note.md', encode('note'))).toMatchObject({ completed: 0, total: 1, error })
  })
})
