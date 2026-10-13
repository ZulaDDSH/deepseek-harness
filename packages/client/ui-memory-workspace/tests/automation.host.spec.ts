import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { registerHumanOperations, type McpHumanOperations } from '../../../mcp/mcp-client/src/human-operations.ts'
import MemoryWorkspace, { type Config } from '../src/index.ts'
import { SessionDigest, memoryPolicy, recallText, scrub, workspaceEntity } from '../src/automation.ts'

function asText(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value) }

vi.mock('@deepseek-ai/dsh-native-command', () => ({ runNativeCommand: vi.fn(async () => ({ stdout: '', stderr: '' })) }))

const roots: Context[] = [], directories: string[] = [], databases: DatabaseSync[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const db of databases.splice(0)) { try { db.close() } catch { /* already closed by the test */ } }
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const MIGRATIONS = [
  '1.2-code-state-snapshots', '1.2-knowledge-claim-ledger', '1.2-knowledge-workspace',
  '1.2-workflow-inheritance', '1.2.2-observation-admission', '1.2.2-observation-visibility',
  '1.2.7-compaction-checkpoints', '1.3-long-term-memory',
]
const CWD = join(tmpdir(), 'dsh-memory-project')

interface Fixture {
  ctx: Context
  fiber: { dispose(): Promise<void> }
  db: DatabaseSync
  calls: Record<string, unknown>[]
  directory: string
}

async function fixture(config: Partial<Config> = {}, call?: McpHumanOperations['call']): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-memory-automation-'))
  directories.push(directory)
  const db = new DatabaseSync(join(directory, 'memorix.db'))
  databases.push(db)
  db.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY); CREATE TABLE observations(id INTEGER PRIMARY KEY, entityName TEXT, title TEXT, narrative TEXT, topicKey TEXT UNIQUE, projectId TEXT DEFAULT \'fixture\', status TEXT DEFAULT \'active\', createdAt TEXT)')
  for (const id of MIGRATIONS) db.prepare('INSERT INTO schema_migrations VALUES (?)').run(id)
  const calls: Record<string, unknown>[] = []
  const ctx = new Context()
  roots.push(ctx)
  registerHumanOperations(ctx, 'memorix', {
    local: true, cwd: directory, env: { MEMORIX_DATA_DIR: directory },
    call: call ?? (async (name, args) => {
      expect(name).toBe('memorix_store')
      calls.push(args)
      db.prepare('INSERT INTO observations(entityName, title, narrative, topicKey, createdAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(topicKey) DO UPDATE SET narrative = excluded.narrative, title = excluded.title')
        .run(asText(args.entityName), asText(args.title), asText(args.narrative), asText(args.topicKey), new Date().toISOString())
      const row = db.prepare('SELECT id FROM observations WHERE topicKey = ?').get(asText(args.topicKey))
      return { content: [{ type: 'text', text: `[OK] Stored observation #${row?.id} "t" (~1 tokens)\nEntity: e | Type: session-request | Project: fixture | Topic: ${asText(args.topicKey)}` }] }
    }),
  })
  const fiber = ctx.plugin(MemoryWorkspace, { importDirectory: join(directory, 'documents'), autoSaveDelayMs: 20, ...config })
  await fiber.await()
  return { ctx, fiber, db, calls, directory }
}

const session = (id = 's1', header: Record<string, unknown> = {}) => ({ id, header: { cwd: CWD, createdAt: Date.now(), ...header } })
type FakeSession = ReturnType<typeof session>
const text = (value: string) => [{ type: 'text', text: value }]
let seq = 0
function emit(ctx: Context, target: FakeSession, type: string, data: unknown): void {
  ctx.emit('session/event', target as never, { type, seq: seq++, time: 0, data } as never)
}
const prompt = (ctx: Context, target: FakeSession, value: string): void => { emit(ctx, target, 'user/message', { role: 'user', content: text(value), source: { kind: 'user' } }) }
const reply = (ctx: Context, target: FakeSession, value: string): void => { emit(ctx, target, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: text(value) }, stream: [] }) }
const done = (ctx: Context, target: FakeSession, kind = 'completed'): void => { emit(ctx, target, 'turn/end', { turn: 1, reason: { kind } }) }

describe('Memory digest', () => {
  it('redacts credential-shaped text and keeps only the latest turns within the bound', () => {
    expect(scrub(`use sk-${'abcdefghij'.repeat(2)}uv and password: hunter2\n now`)).toBe('use [redacted] and [redacted] now')
    expect(scrub('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123')).toBe('Authorization: [redacted]')
    const digest = new SessionDigest(session(), 1)
    for (let turn = 1; turn <= 12; turn++) {
      digest.begin(`request ${turn}`)
      digest.answer(`result ${turn} ${'x'.repeat(300)}`)
      expect(digest.finish()).toBe(true)
    }
    const narrative = digest.narrative(1200)!
    expect(Array.from(narrative).length).toBeLessThanOrEqual(1200)
    expect(narrative).toContain('Turn 12. User: request 12')
    expect(narrative).not.toContain('request 1 ')
    expect(narrative.indexOf('Turn 11.')).toBeLessThan(narrative.indexOf('Turn 12.'))
    expect(digest.title).toBe('Session: request 1')
    expect(new SessionDigest(session(), 1).narrative(500)).toBeUndefined()
  })

  it('skips a turn that carried neither a request nor a reply', () => {
    const digest = new SessionDigest(session(), 1)
    expect(digest.finish()).toBe(false)
    digest.answer('   ')
    expect(digest.finish()).toBe(false)
  })

  it('names one entity per workspace folder', () => {
    expect(workspaceEntity(CWD)).toBe(workspaceEntity(CWD))
    expect(workspaceEntity(join(CWD, 'a'))).not.toBe(workspaceEntity(join(CWD, 'b')))
    expect(workspaceEntity(CWD)).toMatch(/^dsh-workspace:dsh-memory-project-[0-9a-f]{8}$/)
  })

  it('renders the policy and the recalled context within their bounds', () => {
    expect(memoryPolicy('mcp__memorix__memorix_store', undefined, false)).toContain('mcp__memorix__memorix_store')
    expect(memoryPolicy('s', 'q', true)).toContain('call q for relevant decisions')
    expect(memoryPolicy('s', 'q', true)).toContain('saves a short session digest automatically')
    expect(recallText([], 1000)).toBe('')
    const rows = [1, 2, 3].map(index => ({ title: `digest ${index}`, narrative: 'n'.repeat(2000), createdAt: `2026-01-0${index}T00:00:00.000Z` }))
    expect(Array.from(recallText(rows, 900)).length).toBeLessThanOrEqual(900)
    expect(recallText(rows, 900)).toContain('2026-01-02 digest 2')
  })
})

describe('Automatic memory saves', () => {
  it('writes one rolling digest per session after a quiet period and updates it instead of duplicating', async () => {
    const { ctx, db, calls } = await fixture()
    const chat = session()
    prompt(ctx, chat, 'Fix the login bug')
    reply(ctx, chat, 'Planning the change.')
    reply(ctx, chat, 'Fixed it, token: abcd1234 verified by tests.')
    done(ctx, chat)
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    expect(calls[0]).toMatchObject({
      entityName: workspaceEntity(CWD), type: 'session-request', title: 'Session: Fix the login bug',
      concepts: ['dsh-session', 'automatic-digest'],
    })
    expect(String(calls[0]!.topicKey)).toMatch(/^dsh-session:s1:\d+$/)
    expect(String(calls[0]!.narrative)).toContain('User: Fix the login bug | Outcome: Fixed it, [redacted] verified by tests.')
    expect(String(calls[0]!.narrative)).not.toContain('Planning the change')

    prompt(ctx, chat, 'Now add a test')
    reply(ctx, chat, 'Added the regression test.')
    done(ctx, chat)
    await vi.waitFor(() => { expect(calls).toHaveLength(2) })
    expect(calls[1]!.topicKey).toBe(calls[0]!.topicKey)
    expect(String(calls[1]!.narrative)).toContain('Turn 2. User: Now add a test')
    expect(db.prepare('SELECT COUNT(*) AS n FROM observations').get()?.n).toBe(1)
  })

  it('coalesces a burst of turns into one write and does not rewrite an unchanged digest', async () => {
    const { ctx, calls } = await fixture({ autoSaveDelayMs: 60 })
    const chat = session()
    for (const request of ['one', 'two', 'three']) { prompt(ctx, chat, request); reply(ctx, chat, `${request} done`); done(ctx, chat) }
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    expect(String(calls[0]!.narrative)).toContain('Turn 3. User: three')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(calls).toHaveLength(1)
    done(ctx, chat)
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(calls).toHaveLength(1)
  })

  it('saves a compaction summary immediately under its own topic key', async () => {
    const { ctx, calls } = await fixture({ autoSaveDelayMs: 60_000 })
    const chat = session()
    emit(ctx, chat, 'compaction/summary', { compactionId: 'c9', summary: text('Goal: ship the memory page. Decision: newest first.') })
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    expect(String(calls[0]!.topicKey)).toMatch(/^dsh-session:s1:\d+:compaction:c9$/)
    expect(calls[0]!.title).toBe('Session summary: Goal: ship the memory page. Decision: newest first.')
    expect(String(calls[0]!.narrative)).toContain('Decision: newest first.')
    emit(ctx, chat, 'compaction/summary', { compactionId: 'c10', summary: text('   ') })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(calls).toHaveLength(1)
  })

  it('ignores subagent sessions, interrupted replies and turns that did not complete', async () => {
    const { ctx, calls } = await fixture()
    const child = session('child', { origin: 'subagent' })
    prompt(ctx, child, 'delegated work'); reply(ctx, child, 'done'); done(ctx, child)
    const chat = session('s2')
    prompt(ctx, chat, 'will be cancelled')
    emit(ctx, chat, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: text('partial') }, stream: [], interrupted: true })
    done(ctx, chat, 'aborted')
    emit(ctx, chat, 'user/message', { role: 'user', content: text('injected context'), source: { kind: 'hooks-claude-code' } })
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(calls).toHaveLength(0)
  })

  it('never breaks the turn when Memorix fails, and recovers on the next turn', async () => {
    const calls: number[] = []
    const { ctx, db } = await fixture({}, async (_name, args) => {
      calls.push(calls.length)
      if (calls.length === 1) throw new Error('server is disconnected')
      db.prepare('INSERT INTO observations(entityName, title, narrative, topicKey, createdAt) VALUES (?, ?, ?, ?, ?)').run('e', 't', asText(args.narrative), asText(args.topicKey), 'now')
      const row = db.prepare('SELECT id FROM observations').get()
      return { content: [{ type: 'text', text: `[OK] Stored observation #${row?.id} "t"\nEntity: e | Type: x | Project: fixture | Topic: k` }] }
    })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const chat = session()
    prompt(ctx, chat, 'first'); reply(ctx, chat, 'one'); done(ctx, chat)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('automatic memory save failed: server is disconnected')) })
    prompt(ctx, chat, 'second'); reply(ctx, chat, 'two'); done(ctx, chat)
    await vi.waitFor(() => { expect(calls).toHaveLength(2) })
    await vi.waitFor(() => { expect(db.prepare('SELECT COUNT(*) AS n FROM observations').get()?.n).toBe(1) })
  })

  it('reports an unacknowledged or unreadable write with the server text and logs repeats quietly', async () => {
    const { ctx } = await fixture({}, async () => ({ content: [{ type: 'text', text: 'Memorix write boundary: read-only task' }] }))
    const warn = vi.spyOn(ctx.logger, 'warn')
    const info = vi.spyOn(ctx.logger, 'info')
    const chat = session()
    for (const request of ['a', 'b']) {
      prompt(ctx, chat, request); reply(ctx, chat, request); done(ctx, chat)
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    await vi.waitFor(() => { expect(info).toHaveBeenCalled() })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('Memorix did not persist the complete session digest: Memorix write boundary: read-only task')
  })

  it('reports a digest it cannot read back from a misconfigured local database', async () => {
    const { ctx, calls } = await fixture({ databasePath: join(tmpdir(), 'dsh-memory-missing', 'memorix.db') })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const chat = session()
    prompt(ctx, chat, 'misconfigured'); reply(ctx, chat, 'stored but unreadable'); done(ctx, chat)
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('Memorix database not found')) })
  })

  it('flushes a digest still waiting for its quiet period when the plugin is disposed', async () => {
    const { ctx, fiber, calls } = await fixture({ autoSaveDelayMs: 600_000 })
    const chat = session()
    prompt(ctx, chat, 'last words'); reply(ctx, chat, 'saved on close'); done(ctx, chat)
    expect(calls).toHaveLength(0)
    await fiber.dispose()
    expect(calls).toHaveLength(1)
    expect(String(calls[0]!.narrative)).toContain('saved on close')
  })

  it('flushes when the session is disposed and does nothing when autoSave is off', async () => {
    const live = await fixture({ autoSaveDelayMs: 600_000 })
    const chat = session()
    prompt(live.ctx, chat, 'goodbye'); reply(live.ctx, chat, 'bye'); done(live.ctx, chat)
    live.ctx.emit('session/disposed', chat as never)
    await vi.waitFor(() => { expect(live.calls).toHaveLength(1) })

    const off = await fixture({ autoSave: false, autoSaveDelayMs: 1 })
    prompt(off.ctx, chat, 'x'); reply(off.ctx, chat, 'y'); done(off.ctx, chat)
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(off.calls).toHaveLength(0)
  })
})

describe('Memory policy and recall', () => {
  function register(ctx: Context, name: string): void {
    ctx.tools.register(defineTool({
      name, description: name, parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: () => Promise.resolve('ok'),
    }))
  }

  it('adds the saving policy only while the Memorix store tool is visible', async () => {
    const { ctx } = await fixture()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const policy = async (): Promise<string | undefined> =>
      (await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'memory:policy')?.text
    expect(await policy()).toBe('')
    register(ctx, 'mcp__memorix__memorix_store')
    const text = (await policy())!
    expect(text).toContain('mcp__memorix__memorix_store')
    expect(text).not.toContain('memorix_search')
    register(ctx, 'mcp__memorix__memorix_search')
    expect(await policy()).toContain('mcp__memorix__memorix_search')
  })

  it('omits the section when policy is off and recalls nothing when recall is off', async () => {
    const { ctx } = await fixture({ policy: false, recall: false })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    register(ctx, 'mcp__memorix__memorix_store')
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(section => section.name === 'memory:policy')).toBe(false)
    expect(assembly.contexts.some(context => context.name === 'memory:recall')).toBe(false)
  })

  it('recalls earlier digests of the same workspace at session start, bounded and excluding the current session', async () => {
    const { ctx, db } = await fixture({ memoryCharacters: 600 })
    await ctx.plugin(SystemPrompt)
    const entity = workspaceEntity(CWD)
    const insert = db.prepare('INSERT INTO observations(entityName, title, narrative, topicKey, createdAt) VALUES (?, ?, ?, ?, ?)')
    insert.run(entity, 'Session: older', `older ${'o'.repeat(900)}`, 'dsh-session:old:1', '2020-01-01T00:00:00.000Z')
    insert.run(entity, 'Session: newer', 'newer digest text', 'dsh-session:new:1', '2020-02-01T00:00:00.000Z')
    insert.run(entity, 'Session: mine', 'own digest', 'dsh-session:s1:5', '2020-03-01T00:00:00.000Z')
    insert.run('dsh-workspace:other', 'Session: elsewhere', 'other workspace', 'dsh-session:x:1', '2020-02-15T00:00:00.000Z')
    const chat = session('s1', { createdAt: Date.parse('2026-01-01T00:00:00.000Z') })
    await ctx.serial('agent/created', { agent: { session: chat }, source: 'startup' } as never)
    const recalled = async (id: string): Promise<string> =>
      (await ctx.systemPrompt.assemble({ agent: { session: { id } } } as never)).contexts.find(context => context.name === 'memory:recall')?.text ?? ''
    const text = await recalled('s1')
    expect(text).toContain('Automatic notes from earlier sessions')
    expect(text).toContain('2020-02-01 Session: newer')
    expect(text).toContain('2020-01-01 Session: older')
    expect(text).not.toContain('own digest')
    expect(text).not.toContain('other workspace')
    expect(Array.from(text).length).toBeLessThanOrEqual(600)
    expect(text.indexOf('newer')).toBeLessThan(text.indexOf('older'))
    expect(await recalled('unknown')).toBe('')
    ctx.emit('session/disposed', chat as never)
    expect(await recalled('s1')).toBe('')
  })

  it('skips recall for subagents and sessions without a workspace and survives an unreadable store', async () => {
    const { ctx, db, directory } = await fixture()
    await ctx.plugin(SystemPrompt)
    const warn = vi.spyOn(ctx.logger, 'warn')
    await ctx.serial('agent/created', { agent: { session: session('c', { origin: 'subagent' }) }, source: 'startup' } as never)
    await ctx.serial('agent/created', { agent: { session: { id: 'n', header: { createdAt: 1 } } }, source: 'startup' } as never)
    expect(warn).not.toHaveBeenCalled()
    db.close()
    await rm(join(directory, 'memorix.db'))
    await ctx.serial('agent/created', { agent: { session: session('d') }, source: 'startup' } as never)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('automatic memory recall failed'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Memorix database not found'))
    const assembled = await ctx.systemPrompt.assemble({ agent: { session: { id: 'd' } } } as never)
    expect(assembled.contexts.find(context => context.name === 'memory:recall')?.text ?? '').toBe('')
  })
})
