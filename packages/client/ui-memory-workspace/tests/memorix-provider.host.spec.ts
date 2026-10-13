import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import MemoryWorkspace from '../src/index.ts'
import { workspaceEntity } from '../src/automation.ts'

const cli = process.env.DSH_MEMORIX_ACCEPTANCE_CLI
it.skipIf(cli === undefined)('imports through a real Memorix process into an isolated store and reads every chunk back', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-memorix-acceptance-'))
  vi.stubEnv('MEMORIX_DATA_DIR', directory)
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(McpClient, { transport: 'stdio', serverName: 'memorix', command: process.execPath,
      args: [cli ?? '', 'serve', '--mode', 'lite'], cwd: process.cwd(),
      env: { MEMORIX_SQLITE_DRIVER: 'node', __MEMORIX_HEAP: '1' },
      failOnStartupError: true, toolCallTimeoutMs: 30000,
    })
    await ctx.plugin(MemoryWorkspace, { importDirectory: join(directory, 'uploads'), chunkCharacters: 80 })
    const text = 'A user uploaded guide. Preserve the complete source, including Unicode 😀. '.repeat(3)
    const result = await ctx.memoryWorkspace.importDocument('guide.md', Buffer.from(text).toString('base64'))
    expect(result).toMatchObject({ error: null, completed: result.total })
    expect(result.total).toBeGreaterThan(1)
    expect(await readFile(result.originalPath, 'utf8')).toBe(text)
    const page = await ctx.memoryWorkspace.page('observations', 0, 'user uploaded', 'all')
    expect(page.total).toBeGreaterThan(0)
    const all = await ctx.memoryWorkspace.page('observations', 0, '', 'all')
    expect([...all.rows].reverse().map(row => z.string().parse(row.narrative)).join('')).toBe(text)
    expect((await ctx.memoryWorkspace.importDocument('guide.md', Buffer.from(text).toString('base64'))).completed).toBe(result.total)
    expect((await ctx.memoryWorkspace.page('observations', 0, '', 'all')).total).toBe(result.total)
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  }
}, 120000)

it.skipIf(cli === undefined)('saves a session digest through a real Memorix process and recalls it in a later session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-memorix-acceptance-'))
  vi.stubEnv('MEMORIX_DATA_DIR', directory)
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(McpClient, { transport: 'stdio', serverName: 'memorix', command: process.execPath,
      args: [cli ?? '', 'serve', '--mode', 'lite'], cwd: process.cwd(),
      env: { MEMORIX_SQLITE_DRIVER: 'node', __MEMORIX_HEAP: '1' },
      failOnStartupError: true, toolCallTimeoutMs: 30000,
    })
    await ctx.plugin(MemoryWorkspace, { importDirectory: join(directory, 'uploads'), autoSaveDelayMs: 1 })
    const cwd = join(directory, 'workspace')
    const first = { id: 'acceptance-1', header: { cwd, createdAt: Date.now() } }
    let seq = 0
    const emit = (type: string, data: unknown): void => { ctx.emit('session/event', first as never, { type, seq: seq++, time: 0, data } as never) }
    const turn = (prompt: string, answer: string): void => {
      emit('user/message', { role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })
      emit('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: answer }] }, stream: [] })
      emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }
    const digests = async () => (await ctx.memoryWorkspace.page('observations', 0, 'dsh-session:acceptance-1:', 'memories')).rows
    turn('Fix the login bug', 'Fixed and verified by tests.')
    await vi.waitFor(async () => { expect(await digests()).toHaveLength(1) }, { timeout: 20000 })
    turn('Add a regression test', 'Added the regression test.')
    await vi.waitFor(async () => { expect(JSON.stringify((await digests())[0]?.narrative)).toContain('Turn 2. User: Add a regression test') }, { timeout: 20000 })
    expect(await digests()).toHaveLength(1)
    expect((await digests())[0]).toMatchObject({ entityName: workspaceEntity(cwd), type: 'session-request' })
    const later = { id: 'acceptance-2', header: { cwd, createdAt: Date.now() + 1000 } }
    await ctx.serial('agent/created', { agent: { session: later }, source: 'startup' } as never)
    const recall = (await ctx.systemPrompt.assemble({ agent: { session: { id: 'acceptance-2' } } } as never)).contexts.find(context => context.name === 'memory:recall')?.text ?? ''
    expect(recall).toContain('Fix the login bug')
    const policy = (await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'memory:policy')?.text ?? ''
    expect(policy).toContain('memorix_store')
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  }
}, 120000)
