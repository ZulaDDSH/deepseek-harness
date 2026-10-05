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
    const page = await ctx.memoryWorkspace.page('observations', 0, 'user uploaded')
    expect(page.total).toBeGreaterThan(0)
    const all = await ctx.memoryWorkspace.page('observations', 0, '')
    expect(all.rows.map(row => z.string().parse(row.narrative)).join('')).toBe(text)
    expect((await ctx.memoryWorkspace.importDocument('guide.md', Buffer.from(text).toString('base64'))).completed).toBe(result.total)
    expect((await ctx.memoryWorkspace.page('observations', 0, '')).total).toBe(result.total)
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  }
}, 120000)
