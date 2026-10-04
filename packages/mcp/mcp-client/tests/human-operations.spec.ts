import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import { fileURLToPath } from 'node:url'
import * as McpClient from '../src/index.ts'
import { registerHumanOperations } from '../src/human-operations.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

describe('Host-owned human MCP operations', () => {
  it('uses the live discovered provider, validates arguments and preserves filtering and disposal', async () => {
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(McpClient, {
      transport: 'stdio', serverName: 'example', command: process.execPath,
      args: ['--import', 'tsx/esm', fileURLToPath(new URL('./fixture-server.ts', import.meta.url))],
      env: {}, cwd: process.cwd(), toolCallTimeoutMs: 5000, failOnStartupError: true,
      toolFilter: { allow: ['add'], deny: [] },
    })
    const provider = await ctx.waterfall('mcp/human-operations', 'example', async () => undefined)
    expect(provider).toBeDefined()
    const signal = new AbortController().signal
    await expect(provider?.call('add', { a: 2, b: 3 }, signal)).resolves.toMatchObject({ content: [{ type: 'text', text: '5' }] })
    await expect(provider?.call('add', { a: 'bad', b: 3 }, signal)).rejects.toThrow('invalid tool arguments')
    await expect(provider?.call('greet', { name: 'hello' }, signal)).rejects.toThrow('tool is unavailable')
    expect(await ctx.waterfall('mcp/human-operations', 'another', async () => undefined)).toBeUndefined()
    await fiber.dispose()
    expect(await ctx.waterfall('mcp/human-operations', 'example', async () => undefined)).toBeUndefined()
    await expect(provider?.call('add', { a: 2, b: 3 }, signal)).rejects.toThrow('server is disconnected')
  })

  it('does not expose an Agent-scoped server as global human access', async () => {
    const ctx = new Context()
    roots.push(ctx)
    const scoped = createScope(ctx, {})
    registerHumanOperations(scoped.ctx, 'private', { local: true, cwd: '', env: {}, call: async () => ({}) })
    expect(await ctx.waterfall('mcp/human-operations', 'private', async () => undefined)).toBeUndefined()
  })
})
