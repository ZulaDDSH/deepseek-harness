import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { memorixLaunch } from '@deepseek-ai/dsh-web-app/memorix'
import MemoryWorkspace from '@deepseek-ai/dsh-client-ui-memory-workspace'

const directories: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

async function start(gitRepository: boolean, gitOnPath = true): Promise<{ ctx: Context; home: string; project: string }> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-bundled-memorix-')))
  directories.push(home)
  const project = join(home, 'project')
  if (gitRepository) execFileSync('git', ['init', '-q', '--', 'project'], { cwd: home })
  else mkdirSync(project)
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('DSH_HOME', join(home, 'dsh'))
  vi.stubEnv('MEMORIX_DATA_DIR', join(home, 'data'))
  if (!gitOnPath) vi.stubEnv('PATH', dirname(process.execPath))
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const launch = memorixLaunch()
  await ctx.plugin(mcpClient, {
    serverName: 'memorix', transport: 'stdio', command: launch.command, args: launch.args,
    env: { MEMORIX_SQLITE_DRIVER: 'node', ELECTRON_RUN_AS_NODE: '1' }, cwd: home,
  }).await()
  await ctx.plugin(MemoryWorkspace, { importDirectory: join(home, 'documents') }).await()
  expect(await ctx.memoryWorkspace.status()).toMatchObject({ server: 'ready', chatMemory: true })
  return { ctx, home, project }
}

async function saveTurnAndRecallInNextChat(gitRepository: boolean, gitOnPath = true): Promise<void> {
  const { ctx, project } = await start(gitRepository, gitOnPath)

  const chat = { id: 'first', header: { cwd: project, createdAt: Date.now() }, ownEvents: () => [] }
  const emit = (type: string, data: unknown): void => { ctx.emit('session/event', chat as never, { type, seq: 1, time: 0, data } as never) }
  emit('user/message', { role: 'user', content: [{ type: 'text', text: 'How do we rotate the zebra cache?' }], source: { kind: 'user' } })
  const answer = [{ type: 'text', text: 'Run the zebra rotation script nightly.' }]
  emit('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: answer }, stream: [] })
  emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await vi.waitFor(async () => {
    const saved = await ctx.memoryWorkspace.status()
    expect(saved.saveFailure).toBeUndefined()
    expect(saved.lastSavedAt).toBeDefined()
  }, { timeout: 30_000, interval: 200 })

  const next = { id: 'second', header: { cwd: project, createdAt: Date.now() }, ownEvents: () => [] }
  ctx.emit('agent/inbox/inserted', { agent: { session: next }, message: { role: 'user', content: [{ type: 'text', text: 'zebra cache rotation' }], source: { kind: 'user' } } } as never)
  const recalled = (await ctx.systemPrompt.assemble({ agent: { session: next } } as never)).contexts.find(entry => entry.name === 'memory:recall')?.text ?? ''
  expect(recalled).toContain('zebra rotation script')
  const status = await ctx.memoryWorkspace.status()
  expect(status.server).toBe('ready')
  expect(status.recallFailure).toBeUndefined()
  expect(status.lastRecalledAt).toBeDefined()
}

it('saves a finished turn through the bundled Memorix server and recalls it for the next chat', () => saveTurnAndRecallInNextChat(true), 90_000)

it('saves a finished turn from a folder that is not a Git repository and recalls it for the next chat', () => saveTurnAndRecallInNextChat(false), 90_000)

it('saves and recalls a turn from a plain folder when no git executable is on the PATH', () => saveTurnAndRecallInNextChat(false, false), 90_000)

it('imports a document before any chat has bound a project, with no git executable on the PATH', async () => {
  const { ctx } = await start(false, false)
  const text = 'The quokka import guide explains the nightly rotation. '.repeat(4)
  const result = await ctx.memoryWorkspace.importDocument('guide.md', Buffer.from(text).toString('base64'))
  expect(result).toMatchObject({ error: null, completed: result.total })
  const stored = await ctx.memoryWorkspace.page('observations', 0, 'quokka', 'documents')
  expect(stored.total).toBeGreaterThan(0)
  expect(stored.rows.map(row => row.projectId)).toEqual(stored.rows.map(() => 'local/documents'))
}, 90_000)
