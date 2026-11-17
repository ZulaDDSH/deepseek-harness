import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { createVolatile, updateVolatile, type Volatile } from '@deepseek-ai/cosmokit'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { registerHumanOperations, type McpHumanOperations } from '../../../mcp/mcp-client/src/human-operations.ts'
import MemoryWorkspace, { type Config } from '../src/index.ts'
import { SessionTurns, memoryPolicy, recallText, scrub, turnRecord, workspaceEntity } from '../src/automation.ts'

function asText(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value) }

vi.mock('@deepseek-ai/dsh-native-command', () => ({ runNativeCommand: vi.fn(async () => ({ stdout: '', stderr: '' })) }))

const roots: Context[] = [], directories: string[] = [], databases: DatabaseSync[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
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
const PROJECT_ROOT_TEXT = 'Session bound'

interface Fixture {
  ctx: Context
  fiber: Fiber
  db: DatabaseSync
  calls: Record<string, unknown>[]
  bindings: unknown[]
  searches: unknown[]
  directory: string
}

interface Options {
  config?: Partial<Omit<Config, 'chatMemory'>> & { chatMemory?: boolean }
  call?: McpHumanOperations['call']
  search?: string
}

const storeText = (db: DatabaseSync, args: Record<string, unknown>): string => {
  db.prepare('INSERT INTO observations(entityName, title, narrative, topicKey, createdAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(topicKey) DO UPDATE SET narrative = excluded.narrative, title = excluded.title')
    .run(asText(args.entityName), asText(args.title), asText(args.narrative), asText(args.topicKey), new Date().toISOString())
  const row = db.prepare('SELECT id FROM observations WHERE topicKey = ?').get(asText(args.topicKey))
  return `[OK] Stored observation #${row?.id} "t" (~1 tokens)\nEntity: e | Type: session-request | Project: fixture | Topic: ${asText(args.topicKey)}`
}

async function fixture({ config = {}, call, search = '' }: Options = {}): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-memory-automation-'))
  directories.push(directory)
  vi.stubEnv('DSH_HOME', join(directory, 'dsh'))
  const db = new DatabaseSync(join(directory, 'memorix.db'))
  databases.push(db)
  db.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY); CREATE TABLE observations(id INTEGER PRIMARY KEY, entityName TEXT, title TEXT, narrative TEXT, topicKey TEXT UNIQUE, projectId TEXT DEFAULT \'fixture\', status TEXT DEFAULT \'active\', createdAt TEXT)')
  for (const id of MIGRATIONS) db.prepare('INSERT INTO schema_migrations VALUES (?)').run(id)
  const calls: Record<string, unknown>[] = []
  const bindings: unknown[] = []
  const searches: unknown[] = []
  const ctx = new Context()
  roots.push(ctx)
  ctx.provide('sessionProjections', {
    snapshot: (hosted: { cliProfile?: string }) => ({ values: { cliTerminal: { profile: hosted.cliProfile ?? null } } }),
  } as never)
  registerHumanOperations(ctx, 'memorix', {
    local: true, cwd: directory, env: { MEMORIX_DATA_DIR: directory },
    call: call ?? (async (name, args) => {
      if (name === 'memorix_session_start') {
        bindings.push(args.projectRoot)
        return { content: [{ type: 'text', text: PROJECT_ROOT_TEXT }] }
      }
      if (name === 'memorix_search') {
        searches.push(args)
        return { content: [{ type: 'text', text: search }] }
      }
      expect(name).toBe('memorix_store')
      calls.push(args)
      return { content: [{ type: 'text', text: storeText(db, args) }] }
    }),
  })
  const fiber = ctx.plugin(MemoryWorkspace, { importDirectory: join(directory, 'documents'), ...config })
  await fiber.await()
  return { ctx, fiber, db, calls, bindings, searches, directory }
}

const session = (id = 's1', header: Record<string, unknown> = {}) => ({ id, header: { cwd: CWD, createdAt: Date.now(), ...header }, ownEvents: () => [] })
const cliSession = (id = 'cli') => ({ ...session(id), cliProfile: 'gemini-cli' }) as never
type FakeSession = ReturnType<typeof session>
const text = (value: string) => [{ type: 'text', text: value }]
let seq = 0
function emit(ctx: Context, target: FakeSession, type: string, data: unknown): void {
  ctx.emit('session/event', target as never, { type, seq: seq++, time: 0, data } as never)
}
const prompt = (ctx: Context, target: FakeSession, value: string): void => { emit(ctx, target, 'user/message', { role: 'user', content: text(value), source: { kind: 'user' } }) }
const reply = (ctx: Context, target: FakeSession, value: string): void => { emit(ctx, target, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: text(value) }, stream: [] }) }
const done = (ctx: Context, target: FakeSession, kind = 'completed'): void => { emit(ctx, target, 'turn/end', { turn: 1, reason: { kind } }) }
const inbox = (ctx: Context, target: FakeSession, value: string, source = 'user'): void => {
  ctx.emit('agent/inbox/inserted', { agent: { session: target }, message: { role: 'user', content: text(value), source: { kind: source } } } as never)
}
const assembled = async (ctx: Context, id: string): Promise<string> =>
  (await ctx.systemPrompt.assemble({ agent: { session: { id } } } as never)).contexts.find(context => context.name === 'memory:recall')?.text ?? ''

describe('Memory digest', () => {
  it('redacts credential-shaped text and bounds each turn record', () => {
    expect(scrub(`use sk-${'abcdefghij'.repeat(2)}uv and password: hunter2\n now`)).toBe('use [redacted] and [redacted] now')
    expect(scrub('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123')).toBe('Authorization: [redacted]')
    const log = new SessionTurns(session(), 7)
    log.begin('request one')
    log.answer(`result one ${'x'.repeat(300)}`)
    const turn = log.finish()
    expect(turn).toMatchObject({ index: 1, prompt: 'request one' })
    const record = turnRecord(session(), 7, turn!, 200)
    expect(record.topicKey).toBe('dsh-session:s1:7:turn:1')
    expect(record.title).toBe('Turn 1: request one')
    expect(Array.from(record.narrative).length).toBeLessThanOrEqual(200)
    expect(record.narrative).toContain('User: request one | Outcome: result one')
  })

  it.each([
    { label: 'AWS secret access key', input: 'AWS_SECRET_ACCESS_KEY=' + 'a'.repeat(40) + ' next', expected: '[redacted] next' },
    { label: 'underscore KEY env var', input: 'STRIPE_' + 'KEY=' + 'k'.repeat(20) + ' next', expected: '[redacted] next' },
    { label: 'OpenAI-style key', input: 'OPENAI_API_KEY=' + 'sk' + '-' + 'x'.repeat(24), expected: '[redacted]' },
    { label: 'quoted JSON password', input: '{"password": "' + 'p'.repeat(6) + '"}', expected: '{[redacted]}' },
    { label: 'GitHub fine-grained PAT', input: 'token ' + 'github_' + 'pat_' + 'A'.repeat(30), expected: 'token [redacted]' },
    { label: 'Google API key', input: 'key ' + 'AI' + 'za' + 'B'.repeat(35), expected: 'key [redacted]' },
    { label: 'PEM private key block', input: '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----\nabc\ndef\n-----END ' + 'OPENSSH PRIVATE KEY----- done', expected: '[redacted] done' },
    { label: 'URL credentials', input: 'db postgres://' + 'u' + ':' + 'p' + '@h:5432/x', expected: 'db postgres://[redacted]@h:5432/x' },
    { label: 'JWT', input: 'jwt ' + 'ey' + 'J' + 'h'.repeat(10) + '.' + 'b'.repeat(10) + '.' + 's'.repeat(10), expected: 'jwt [redacted]' },
  ])('redacts common credential formats: $label', ({ input, expected }) => {
    expect(scrub(input)).toBe(expected)
  })

  it('leaves ordinary prose that mentions keys and APIs unchanged', () => {
    const prose = 'Refactor the parser; keep the public API stable and the key insight intact.'
    expect(scrub(prose)).toBe(prose)
  })

  it('scrubs a long unbroken run without quadratic backtracking', () => {
    const started = performance.now()
    expect(scrub('a'.repeat(40_000))).toBe('a'.repeat(40_000))
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('skips a turn that carried neither a request nor a reply', () => {
    const log = new SessionTurns(session(), 1)
    expect(log.finish()).toBeUndefined()
    log.answer('   ')
    expect(log.finish()).toBeUndefined()
  })

  it('names one entity per workspace folder', () => {
    expect(workspaceEntity(CWD)).toBe(workspaceEntity(CWD))
    expect(workspaceEntity(join(CWD, 'a'))).not.toBe(workspaceEntity(join(CWD, 'b')))
    expect(workspaceEntity(`${CWD}/`)).toBe(workspaceEntity(CWD))
    expect(workspaceEntity(join(CWD, '..', 'dsh-memory-project'))).toBe(workspaceEntity(CWD))
    expect(workspaceEntity(CWD)).toMatch(/^dsh-workspace:dsh-memory-project-[0-9a-f]{8}$/)
  })

  it('renders the policy and the recalled context within their bounds', () => {
    expect(memoryPolicy('mcp__memorix__memorix_store', undefined, false)).toContain('mcp__memorix__memorix_store')
    expect(memoryPolicy('s', 'q', true)).toContain('call q for relevant decisions')
    expect(memoryPolicy('s', 'q', true)).toContain('records each finished chat turn automatically')
    expect(recallText([], 1000)).toBe('')
    const rows = [1, 2, 3].map(index => ({ title: `digest ${index}`, narrative: 'n'.repeat(2000), createdAt: `2026-01-0${index}T00:00:00.000Z` }))
    expect(Array.from(recallText(rows, 900)).length).toBeLessThanOrEqual(900)
    expect(recallText(rows, 900)).toContain('2026-01-02 digest 2')
    expect(recallText(rows, 900)).toContain('may be stale')
  })
})

describe('Automatic chat saves', () => {
  it('appends one observation per finished turn and never rewrites an earlier turn', async () => {
    const { ctx, db, calls } = await fixture()
    const chat = session()
    prompt(ctx, chat, 'Fix the login bug')
    reply(ctx, chat, 'Planning the change.')
    reply(ctx, chat, 'Fixed it, token: abcd1234 verified by tests.')
    done(ctx, chat)
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    expect(calls[0]).toMatchObject({
      entityName: workspaceEntity(CWD), type: 'session-request', title: 'Turn 1: Fix the login bug',
      concepts: ['dsh-session', 'automatic-turn'],
    })
    expect(String(calls[0]!.topicKey)).toMatch(/^dsh-session:s1:\d+:turn:1$/)
    expect(String(calls[0]!.narrative)).toContain('User: Fix the login bug | Outcome: Fixed it, [redacted] verified by tests.')
    expect(String(calls[0]!.narrative)).not.toContain('Planning the change')

    prompt(ctx, chat, 'Now add a test')
    reply(ctx, chat, 'Added the regression test.')
    done(ctx, chat)
    await vi.waitFor(() => { expect(calls).toHaveLength(2) })
    expect(calls[1]!.topicKey).not.toBe(calls[0]!.topicKey)
    expect(String(calls[1]!.topicKey)).toMatch(/:turn:2$/)
    expect(String(calls[1]!.narrative)).toContain('Turn 2.')
    expect(String(calls[1]!.narrative)).toContain('User: Now add a test')
    expect(db.prepare('SELECT COUNT(*) AS n FROM observations').get()?.n).toBe(2)
    expect(db.prepare('SELECT narrative FROM observations WHERE topicKey LIKE ? ORDER BY id').all('%:turn:1').map(row => row.narrative)).toEqual([calls[0]!.narrative])
  })

  it('saves a compaction summary immediately under its own topic key', async () => {
    const { ctx, calls } = await fixture()
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

  it('never breaks the turn when Memorix fails, reports the failure, and recovers on the next turn', async () => {
    const attempts: number[] = []
    const { ctx, db } = await fixture({ call: async (name, args) => {
      if (name === 'memorix_session_start') return { content: [{ type: 'text', text: PROJECT_ROOT_TEXT }] }
      attempts.push(attempts.length)
      if (attempts.length === 1) throw new Error('server is disconnected')
      return { content: [{ type: 'text', text: storeText(db, args) }] }
    } })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const chat = session()
    prompt(ctx, chat, 'first'); reply(ctx, chat, 'one'); done(ctx, chat)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('automatic memory save failed: server is disconnected')) })
    await vi.waitFor(async () => { expect((await ctx.memoryWorkspace.status()).saveFailure?.message).toBe('server is disconnected') })
    prompt(ctx, chat, 'second'); reply(ctx, chat, 'two'); done(ctx, chat)
    await vi.waitFor(() => { expect(attempts).toHaveLength(2) })
    await vi.waitFor(() => { expect(db.prepare('SELECT COUNT(*) AS n FROM observations').get()?.n).toBe(1) })
    await vi.waitFor(async () => {
      const status = await ctx.memoryWorkspace.status()
      expect(status.saveFailure).toBeUndefined()
      expect(status.lastSavedAt).toEqual(expect.any(String))
    })
  })

  it('reports an unacknowledged write with the server text and logs repeats quietly', async () => {
    const { ctx } = await fixture({ call: async (name) => {
      if (name === 'memorix_session_start') return { content: [{ type: 'text', text: PROJECT_ROOT_TEXT }] }
      return { content: [{ type: 'text', text: 'Memorix write boundary: read-only task' }] }
    } })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const info = vi.spyOn(ctx.logger, 'info')
    const chat = session()
    for (const request of ['a', 'b']) {
      prompt(ctx, chat, request); reply(ctx, chat, request); done(ctx, chat)
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    await vi.waitFor(() => { expect(info).toHaveBeenCalled() })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('Memorix did not persist the complete chat turn: Memorix write boundary: read-only task')
  })

  it('reports a turn it cannot read back from a misconfigured local database', async () => {
    const { ctx, calls } = await fixture({ config: { databasePath: join(tmpdir(), 'dsh-memory-missing', 'memorix.db') } })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const chat = session()
    prompt(ctx, chat, 'misconfigured'); reply(ctx, chat, 'stored but unreadable'); done(ctx, chat)
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('Memorix database not found')) })
  })

  it('stores nothing and recalls nothing while the chat-memory switch is off', async () => {
    const { ctx, calls, searches, bindings } = await fixture({ config: { chatMemory: false } })
    const chat = session()
    prompt(ctx, chat, 'off first'); reply(ctx, chat, 'not saved'); done(ctx, chat)
    inbox(ctx, chat, 'recall should stay off')
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(calls).toHaveLength(0)
    expect(searches).toHaveLength(0)
    expect(bindings).toHaveLength(0)
    expect(await ctx.memoryWorkspace.status()).toEqual({ chatMemory: false, server: 'ready' })
  })

  it('reports a Memorix server that is not mounted as a save failure instead of an error', async () => {
    const ctx = new Context()
    roots.push(ctx)
    const fiber = ctx.plugin(MemoryWorkspace, { importDirectory: join(tmpdir(), 'dsh-memory-unmounted') })
    await fiber.await()
    const chat = session()
    prompt(ctx, chat, 'no server'); reply(ctx, chat, 'answer'); done(ctx, chat)
    await vi.waitFor(async () => {
      const status = await ctx.memoryWorkspace.status()
      expect(status.connection).toContain('Memorix is not connected')
      expect(status.saveFailure?.message).toContain('Memorix is not connected')
    })
  })
})

describe('Memory policy and first-message recall', () => {
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
    await ctx.plugin(NativeToolExecutor)
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

  it('omits the section when policy is off and injects nothing when recall is off', async () => {
    const { ctx } = await fixture({ config: { policy: false, recall: false } })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    register(ctx, 'mcp__memorix__memorix_store')
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(section => section.name === 'memory:policy')).toBe(false)
    expect(assembly.contexts.some(context => context.name === 'memory:recall')).toBe(false)
  })

  it('binds the workspace with memorix_session_start before searching, and rebinds when another workspace is used', async () => {
    const other = join(tmpdir(), 'dsh-memory-other')
    const { ctx, db, bindings, searches, directory } = await fixture({ search: '' })
    await ctx.plugin(SystemPrompt)
    db.prepare('INSERT INTO observations(entityName, title, narrative, topicKey, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(workspaceEntity(CWD), 'Turn 1: earlier', 'earlier narrative', 'dsh-session:old:1:turn:1', '2020-01-01T00:00:00.000Z')
    const chat = session('s1')
    inbox(ctx, chat, 'where is the parser')
    expect(await assembled(ctx, 's1')).toContain('earlier narrative')
    const markerRoots = join(directory, 'dsh', 'memorix-roots')
    expect(bindings).toEqual([expect.stringContaining(markerRoots)])
    expect(searches).toHaveLength(1)
    inbox(ctx, session('s2', { cwd: other }), 'other folder')
    expect(await assembled(ctx, 's2')).toBe('')
    expect(bindings).toEqual([expect.stringContaining(markerRoots), expect.stringContaining(markerRoots)])
    expect(new Set(bindings).size).toBe(2)
  })

  it('binds a folder inside a Git repository by its own path and gives every other folder, including one that only contains a repository, its own project', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-memory-git-'))
    directories.push(base)
    const inside = join(base, 'inside')
    const nested = join(base, 'above', 'src')
    await mkdir(join(inside, 'repo', '.git'), { recursive: true })
    await mkdir(join(base, 'above', '.git'), { recursive: true })
    await mkdir(nested, { recursive: true })
    const { ctx, bindings, directory } = await fixture({ search: '' })
    await ctx.plugin(SystemPrompt)
    inbox(ctx, session('inside', { cwd: inside }), 'where is the parser')
    await assembled(ctx, 'inside')
    inbox(ctx, session('nested', { cwd: nested }), 'where is the parser')
    await assembled(ctx, 'nested')
    expect(bindings).toEqual([expect.stringContaining(join(directory, 'dsh', 'memorix-roots')), nested])
  })

  it('prepares the project folder of a non-Git workspace without running git, keeps it on later binds, and never writes into the workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-memory-plain-'))
    directories.push(workspace)
    const { ctx, bindings } = await fixture({ search: '' })
    await ctx.plugin(SystemPrompt)
    vi.mocked(runNativeCommand).mockClear()
    inbox(ctx, session('plain', { cwd: workspace }), 'first')
    await assembled(ctx, 'plain')
    const root = String(bindings[0])
    expect(await readFile(join(root, '.git', 'HEAD'), 'utf8')).toBe('ref: refs/heads/main\n')
    expect((await readdir(join(root, '.git'))).sort()).toEqual(['HEAD', 'objects', 'refs'])
    expect(await readdir(workspace)).toEqual([])
    await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/trunk\n')
    inbox(ctx, session('other', { cwd: join(workspace, 'x') }), 'second')
    await assembled(ctx, 'other')
    inbox(ctx, session('plain-again', { cwd: workspace }), 'third')
    await assembled(ctx, 'plain-again')
    expect(bindings).toHaveLength(3)
    expect(bindings[2]).toBe(root)
    expect(await readFile(join(root, '.git', 'HEAD'), 'utf8')).toBe('ref: refs/heads/trunk\n')
    expect(runNativeCommand).not.toHaveBeenCalled()
    expect(execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' }).trim()).toBe('.git')
  })

  it('treats a Git repository at the home folder as no repository, as Memorix refuses to bind the home folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-memory-home-'))
    directories.push(home)
    await mkdir(join(home, '.git'))
    await mkdir(join(home, 'work'))
    vi.stubEnv('HOME', home)
    vi.stubEnv('USERPROFILE', home)
    const { ctx, bindings, directory } = await fixture({ search: '' })
    await ctx.plugin(SystemPrompt)
    inbox(ctx, session('home', { cwd: home }), 'at home')
    await assembled(ctx, 'home')
    inbox(ctx, session('work', { cwd: join(home, 'work') }), 'under home')
    await assembled(ctx, 'work')
    expect(bindings).toHaveLength(2)
    for (const root of bindings) expect(String(root)).toContain(join(directory, 'dsh', 'memorix-roots'))
  })

  it('reports an unwritable project folder on the Memory page and still lets the turn start', async () => {
    const { ctx, calls, directory } = await fixture({ search: '' })
    await ctx.plugin(SystemPrompt)
    await writeFile(join(directory, 'dsh'), 'a file where the home folder should be')
    const chat = session('blocked')
    inbox(ctx, chat, 'first message')
    expect(await assembled(ctx, 'blocked')).toBe('')
    prompt(ctx, chat, 'first message'); reply(ctx, chat, 'answer'); done(ctx, chat)
    await vi.waitFor(async () => {
      const status = await ctx.memoryWorkspace.status()
      expect(status.saveFailure?.message).toContain('Cannot prepare the Memorix project folder')
      expect(status.recallFailure?.message).toContain('Cannot prepare the Memorix project folder')
    })
    expect(calls).toHaveLength(0)
  })

  it('recalls the search matches for the first message, scoped to this workspace and excluding this chat', async () => {
    const search = 'Found 4 observation(s) matching "fix the login bug":\n| obs:1@fixture | x |\n| obs:2@fixture | x |\n| obs:3@fixture | x |\n| obs:4@fixture | x |'
    const { ctx, db, searches } = await fixture({ search })
    await ctx.plugin(SystemPrompt)
    const insert = db.prepare('INSERT INTO observations(entityName, title, narrative, topicKey, createdAt) VALUES (?, ?, ?, ?, ?)')
    insert.run(workspaceEntity(CWD), 'Turn 1: login fix', 'login narrative', 'dsh-session:old:1:turn:1', '2020-01-01T00:00:00.000Z')
    insert.run('dsh-workspace:other', 'Turn 1: elsewhere', 'other workspace narrative', 'dsh-session:x:1:turn:1', '2020-02-15T00:00:00.000Z')
    insert.run(workspaceEntity(CWD), 'Turn 1: mine', 'own narrative', 'dsh-session:s1:5:turn:1', '2020-03-01T00:00:00.000Z')
    insert.run(workspaceEntity(CWD), 'Turn 2: unrelated', 'unrelated narrative', 'dsh-session:old:1:turn:2', '2020-04-01T00:00:00.000Z')
    inbox(ctx, session('s1'), 'fix the login bug')
    const recalled = await assembled(ctx, 's1')
    expect(recalled).toContain('Automatic notes from earlier chats')
    expect(recalled).toContain('Turn 1: login fix')
    expect(recalled).toContain('Turn 2: unrelated')
    expect(recalled).not.toContain('own narrative')
    expect(recalled).not.toContain('other workspace narrative')
    expect(searches).toEqual([{ query: 'fix the login bug', limit: 8, scope: 'project', quality: 'fast', status: 'active' }])
  })

  it('bounds the recalled notes within the character limit', async () => {
    const search = 'Found 2 observation(s):\n| obs:1@fixture | x |\n| obs:2@fixture | x |'
    const { ctx, db } = await fixture({ config: { memoryCharacters: 600 }, search })
    await ctx.plugin(SystemPrompt)
    const insert = db.prepare('INSERT INTO observations(entityName, title, narrative, topicKey, createdAt) VALUES (?, ?, ?, ?, ?)')
    insert.run(workspaceEntity(CWD), 'Turn 1: login fix', `login ${'l'.repeat(900)}`, 'dsh-session:old:1:turn:1', '2020-01-01T00:00:00.000Z')
    insert.run(workspaceEntity(CWD), 'Turn 2: login retry', `retry ${'r'.repeat(900)}`, 'dsh-session:old:1:turn:2', '2020-02-01T00:00:00.000Z')
    inbox(ctx, session('s1'), 'fix the login bug')
    const recalled = await assembled(ctx, 's1')
    expect(Array.from(recalled).length).toBeLessThanOrEqual(600)
    expect(recalled).toContain('may be stale')
    expect(recalled).toContain('Turn 1: login fix')
  })

  it('falls back to the latest workspace notes when the search fails, and skips recall when it times out', async () => {
    const failing = await fixture({ call: async (name) => {
      if (name === 'memorix_session_start') return { content: [{ type: 'text', text: PROJECT_ROOT_TEXT }] }
      if (name === 'memorix_search') throw new Error('search index is busy')
      return { content: [{ type: 'text', text: '' }] }
    } })
    await failing.ctx.plugin(SystemPrompt)
    const warn = vi.spyOn(failing.ctx.logger, 'warn')
    failing.db.prepare('INSERT INTO observations(entityName, title, narrative, topicKey, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(workspaceEntity(CWD), 'Turn 1: latest', 'latest narrative', 'dsh-session:old:1:turn:1', '2020-01-01T00:00:00.000Z')
    inbox(failing.ctx, session('s1'), 'anything')
    expect(await assembled(failing.ctx, 's1')).toContain('latest narrative')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('automatic memory recall failed: search index is busy'))

    const hung = await fixture({ call: (name, _args, signal) => {
      if (name === 'memorix_session_start') return Promise.resolve({ content: [{ type: 'text', text: PROJECT_ROOT_TEXT }] })
      return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { reject(new Error('search aborted')) }) })
    } })
    await hung.ctx.plugin(SystemPrompt)
    const hungWarn = vi.spyOn(hung.ctx.logger, 'warn')
    hung.db.prepare('INSERT INTO observations(entityName, title, narrative, topicKey, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(workspaceEntity(CWD), 'Turn 1: slow', 'slow fallback narrative', 'dsh-session:old:1:turn:1', '2020-01-01T00:00:00.000Z')
    inbox(hung.ctx, session('s2'), 'slow search')
    expect(await assembled(hung.ctx, 's2')).toContain('slow fallback narrative')
    expect(hungWarn).toHaveBeenCalledWith(expect.stringContaining('did not finish within 3 s'))
  }, 15_000)

  it('answers a memory lookup from the auto responder with this workspace notes and falls through otherwise', async () => {
    const search = 'Found 1 observation(s) matching "login":\n| obs:1@fixture | x |'
    const { ctx, db, searches } = await fixture({ search })
    const ask = (target: unknown, query = 'login') => ctx.waterfall('memory/lookup', query, target as never, new AbortController().signal, () => Promise.resolve(undefined))
    db.prepare('INSERT INTO observations(entityName, title, narrative, topicKey, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(workspaceEntity(CWD), 'Turn 1: login fix', 'login narrative', 'dsh-session:old:1:turn:1', '2020-01-01T00:00:00.000Z')
    expect(await ask(session('s1'))).toContain('Turn 1: login fix')
    expect(searches).toEqual([{ query: 'login', limit: 8, scope: 'project', quality: 'fast', status: 'active' }])
    expect(await ask(session('s1', { origin: 'subagent' }))).toBeUndefined()
    expect(await ask(session('s1'), '   ')).toBeUndefined()
    expect(searches).toHaveLength(1)
  })

  it('falls through when the lookup finds nothing or the store is unreadable', async () => {
    const { ctx, db, directory } = await fixture({ search: 'Found 1 observation(s):\n| obs:9@fixture | x |' })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const ask = () => ctx.waterfall('memory/lookup', 'q', session('s1') as never, new AbortController().signal, () => Promise.resolve(undefined))
    expect(await ask()).toBeUndefined()
    db.close()
    await rm(join(directory, 'memorix.db'))
    expect(await ask()).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('automatic memory recall failed'))
  })

  it('does not report a lookup that the caller aborted', async () => {
    const { ctx } = await fixture({ call: () => Promise.reject(new Error('aborted mid-call')) })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const gone = new AbortController()
    gone.abort()
    expect(await ctx.waterfall('memory/lookup', 'q', session('s1') as never, gone.signal, () => Promise.resolve(undefined))).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores subagents, sessions without a workspace and CLI terminals for recall', async () => {
    const { ctx, db, searches } = await fixture()
    await ctx.plugin(SystemPrompt)
    db.prepare('INSERT INTO observations(entityName, title, narrative, topicKey, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(workspaceEntity(CWD), 'Turn 1: older', 'older digest', 'dsh-session:old:1:turn:1', '2020-01-01T00:00:00.000Z')
    inbox(ctx, session('c', { origin: 'subagent' }), 'delegated')
    inbox(ctx, { id: 'n', header: { createdAt: 1 }, ownEvents: () => [] } as never, 'no workspace')
    await ctx.serial('agent/created', { agent: { session: cliSession('cli') }, source: 'startup' } as never)
    inbox(ctx, cliSession('cli'), 'typed in the CLI')
    expect(await assembled(ctx, 'c')).toBe('')
    expect(await assembled(ctx, 'cli')).toBe('')
    expect(searches).toEqual([])
  })

  it('reports an unreadable store on recall and still lets the turn start', async () => {
    const { ctx, db, directory, searches } = await fixture({ search: 'Found 1 observation(s):\n| obs:1@fixture | x |' })
    await ctx.plugin(SystemPrompt)
    const warn = vi.spyOn(ctx.logger, 'warn')
    db.close()
    await rm(join(directory, 'memorix.db'))
    inbox(ctx, session('d'), 'after the store vanished')
    expect(await assembled(ctx, 'd')).toBe('')
    expect(searches).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('automatic memory recall failed'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Memorix database not found'))
  })

  it('does not block the first turn when the mounted Memorix client failed to start, and says so on the status', async () => {
    const { ctx, calls } = await fixture({ call: () => Promise.reject(new Error('mcp-client(memorix): server is disconnected')) })
    await ctx.plugin(SystemPrompt)
    ctx.on('mcp-client/inventory', (reports) => { reports.push({ serverName: 'memorix', state: 'failed', toolCount: 0, error: 'Connection closed' }) })
    const chat = session('down')
    const started = Date.now()
    inbox(ctx, chat, 'first message')
    expect(await assembled(ctx, 'down')).toBe('')
    expect(Date.now() - started).toBeLessThan(1500)
    prompt(ctx, chat, 'first message'); reply(ctx, chat, 'answer'); done(ctx, chat)
    await vi.waitFor(async () => {
      const status = await ctx.memoryWorkspace.status()
      expect(status.server).toBe('unavailable')
      expect(status.connection).toContain('"memorix" is failed (Connection closed)')
      expect(status.recallFailure?.message).toContain('server is disconnected')
      expect(status.saveFailure?.message).toContain('server is disconnected')
    })
    expect(calls).toHaveLength(0)
  })

  it('reports a connecting Memorix client as starting, and asks the client to reconnect on retry', async () => {
    const { ctx } = await fixture()
    let state: 'connecting' | 'failed' = 'connecting'
    const reconnects: string[] = []
    ctx.on('mcp-client/inventory', (reports) => { reports.push({ serverName: 'memorix', state, toolCount: 0, ...state === 'failed' ? { error: 'Connection closed' } : {} }) })
    ctx.on('mcp-client/reconnect', (serverName) => { reconnects.push(serverName) })
    expect(await ctx.memoryWorkspace.status()).toMatchObject({ server: 'starting' })
    state = 'failed'
    expect(await ctx.memoryWorkspace.status()).toMatchObject({ server: 'unavailable' })
    expect(await ctx.memoryWorkspace.retry()).toMatchObject({ server: 'unavailable' })
    expect(reconnects).toEqual(['memorix'])
  })

  it('stops waiting for the recall search when the turn is aborted', async () => {
    const { ctx } = await fixture({ call: (name, _args, signal) => {
      if (name === 'memorix_session_start') return Promise.resolve({ content: [{ type: 'text', text: PROJECT_ROOT_TEXT }] })
      return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { reject(new Error('search aborted')) }) })
    } })
    await ctx.plugin(SystemPrompt)
    inbox(ctx, session('abort'), 'slow search')
    const turn = new AbortController()
    setTimeout(() => { turn.abort() }, 50)
    const started = Date.now()
    const assembly = await ctx.systemPrompt.assemble({ agent: { session: { id: 'abort' } }, signal: turn.signal } as never)
    expect(Date.now() - started).toBeLessThan(1500)
    expect(assembly.contexts.find(context => context.name === 'memory:recall')?.text).toBe('')
  })

  it('drops the recalled notes the moment the chat-memory switch is turned off', async () => {
    const { ctx, db, fiber } = await fixture()
    await ctx.plugin(SystemPrompt)
    db.prepare('INSERT INTO observations(entityName, title, narrative, topicKey, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(workspaceEntity(CWD), 'Turn 1: earlier', 'earlier narrative', 'dsh-session:old:1:turn:1', '2020-01-01T00:00:00.000Z')
    inbox(ctx, session('live'), 'anything')
    expect(await assembled(ctx, 'live')).toContain('earlier narrative')
    updateVolatile((fiber.effectiveConfig as { chatMemory: Volatile<boolean> }).chatMemory, createVolatile(false))
    expect(await assembled(ctx, 'live')).toBe('')
    expect(await ctx.memoryWorkspace.status()).toMatchObject({ chatMemory: false })
  })

  it('reports the chat-memory switch and a connected Memorix with no recorded failures', async () => {
    const { ctx } = await fixture()
    expect(await ctx.memoryWorkspace.status()).toEqual({ chatMemory: true, server: 'ready' })
  })
})
