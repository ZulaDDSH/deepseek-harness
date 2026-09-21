/**
 * Tool authority separation over a shared knowledge endpoint.
 *
 * Proves the enforcement point: a restricted MCP tool is denied inside the
 * executor BEFORE the call reaches the remote server, while the same tool
 * succeeds for a scope allowed to call it. The remote server records every
 * invocation, so "blocked locally" is distinguishable from "blocked remotely".
 */

import { describe, expect, it, afterEach } from 'vitest'
import { z } from 'zod'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'

const KNOWLEDGE_TOOLS = ['search', 'recall', 'store_candidate', 'verify', 'promote', 'supersede']
const testToolSignal = new AbortController().signal

interface KnowledgeFixture {
  url: string
  invoked: string[]
  authorization: Array<string | undefined>
  close: () => Promise<void>
}

/** Start a knowledge endpoint exposing retrieval and privileged tools. */
async function startKnowledgeFixture(): Promise<KnowledgeFixture> {
  const invoked: string[] = []
  const authorization: Array<string | undefined> = []
  const handler = createMcpHandler(() => {
    const mcp = new McpServer(
      { name: 'garden-knowledge', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    for (const tool of KNOWLEDGE_TOOLS) {
      mcp.registerTool(tool, { description: `${tool} knowledge.`, inputSchema: z.object({}) }, async (): Promise<CallToolResult> => {
        invoked.push(tool)
        return { content: [{ type: 'text', text: `${tool} ok` }] }
      })
    }
    return mcp
  })
  const handle = toNodeHandler(handler)
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    authorization.push(request.headers.authorization)
    handle(request as NodeIncomingMessageLike, response).catch((error: unknown) => {
      response.writeHead(500).end(String(error))
    })
  })
  const listening: PromiseWithResolvers<void> = Promise.withResolvers()
  server.listen(0, '127.0.0.1', listening.resolve)
  await listening.promise
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('knowledge fixture has no TCP address')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    invoked,
    authorization,
    close: async () => {
      await handler.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      })
    },
  }
}

const fixtures: KnowledgeFixture[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

/** Mount the tool runtime plus one MCP client entry for the fixture. */
async function mount(fixture: KnowledgeFixture, headerEnv: Record<string, string> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(mcpClient, {
    transport: 'streamable-http',
    serverName: 'knowledge',
    url: fixture.url,
    headers: {},
    headerEnv,
    toolCallTimeoutMs: 10_000,
    failOnStartupError: true,
  })
  return ctx
}

/** Mint an agent scope whose key doubles as a minimal Agent-like object. */
async function mintAgentScope(ctx: Context, name: string): Promise<{ scope: Scope; key: Agent }> {
  const key = { id: name as SessionId } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) },
    { inject: ['tools', 'systemPrompt'] }))
  return { scope, key }
}

/** Execute one tool as the given scope's agent and report the first text block. */
async function run(ctx: Context, name: string, agent: Agent): Promise<string> {
  const result = await ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId('c1'),
    name,
    arguments: {},
    agent,
  })
  const first = result.content[0]
  return first?.type === 'text' ? first.text : JSON.stringify(result.content)
}

describe('knowledge tool authority separation', () => {
  it('discovers the knowledge tools under the server namespace', async () => {
    const fixture = await startKnowledgeFixture()
    fixtures.push(fixture)
    const ctx = await mount(fixture)
    const names = ctx.tools.schemas().map(schema => schema.name).sort()
    expect(names).toEqual(KNOWLEDGE_TOOLS.map(tool => `mcp__knowledge__${tool}`).sort())
  })

  it('denies a privileged tool to an ordinary worker before any remote execution', async () => {
    const fixture = await startKnowledgeFixture()
    fixtures.push(fixture)
    const ctx = await mount(fixture)
    const worker = await mintAgentScope(ctx, 'worker')
    worker.scope.ctx.tools.restrict({
      deny: ['mcp__knowledge__verify', 'mcp__knowledge__promote', 'mcp__knowledge__supersede'],
    })

    // The privileged tools are absent from what the worker can see.
    const visible = ctx.tools.schemas(worker.key).map(schema => schema.name)
    expect(visible).toContain('mcp__knowledge__search')
    expect(visible).not.toContain('mcp__knowledge__verify')

    // The denial happens in the executor, so the remote server never sees it.
    expect(await run(ctx, 'mcp__knowledge__verify', worker.key)).toMatch(/unknown tool/)
    expect(fixture.invoked).not.toContain('verify')
  })

  it('lets the same worker call a retrieval tool through to the server', async () => {
    const fixture = await startKnowledgeFixture()
    fixtures.push(fixture)
    const ctx = await mount(fixture)
    const worker = await mintAgentScope(ctx, 'worker')
    worker.scope.ctx.tools.restrict({ deny: ['mcp__knowledge__verify'] })

    await run(ctx, 'mcp__knowledge__search', worker.key)
    expect(fixture.invoked).toContain('search')
  })

  it('lets a supervisor reach a privileged tool the worker cannot', async () => {
    const fixture = await startKnowledgeFixture()
    fixtures.push(fixture)
    const ctx = await mount(fixture)
    const supervisor = await mintAgentScope(ctx, 'supervisor')
    supervisor.scope.ctx.tools.restrict({
      allow: ['mcp__knowledge__search', 'mcp__knowledge__recall', 'mcp__knowledge__store_candidate',
        'mcp__knowledge__verify', 'mcp__knowledge__promote', 'mcp__knowledge__supersede'],
    })

    await run(ctx, 'mcp__knowledge__verify', supervisor.key)
    expect(fixture.invoked).toContain('verify')
  })

  it('keeps the worker denial in force while the supervisor succeeds', async () => {
    const fixture = await startKnowledgeFixture()
    fixtures.push(fixture)
    const ctx = await mount(fixture)
    const worker = await mintAgentScope(ctx, 'worker')
    const supervisor = await mintAgentScope(ctx, 'supervisor')
    worker.scope.ctx.tools.restrict({ deny: ['mcp__knowledge__verify'] })

    expect(await run(ctx, 'mcp__knowledge__verify', worker.key)).toMatch(/unknown tool/)
    await run(ctx, 'mcp__knowledge__verify', supervisor.key)
    expect(fixture.invoked).toEqual(['verify'])
  })

  it('sends the configured credential header to the knowledge endpoint', async () => {
    const fixture = await startKnowledgeFixture()
    fixtures.push(fixture)
    const variable = 'GARDEN_KNOWLEDGE_TOKEN_TEST'
    const original = process.env[variable]
    process.env[variable] = 'Bearer lan-token'
    try {
      await mount(fixture, { Authorization: variable })
      expect(fixture.authorization).toContain('Bearer lan-token')
    } finally {
      if (original === undefined) Reflect.deleteProperty(process.env, variable)
      else process.env[variable] = original
    }
  })
})
