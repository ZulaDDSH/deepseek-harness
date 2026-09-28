/**
 * Shared knowledge over one server: independent DSH clients see the same
 * durable knowledge, project scope prevents cross-project leakage, and the
 * server survives a client restart while clients survive a server restart.
 *
 * The server stores knowledge in a durable file so restart durability is real
 * rather than a re-created in-memory fixture.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { z } from 'zod'
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const TOKEN = 'Bearer garden-test-token'
const testToolSignal = new AbortController().signal

interface KnowledgeRecord {
  id: string
  content: string
  project: string
  scope: 'project' | 'global'
  status: 'candidate' | 'verified' | 'stale' | 'superseded'
  staleReason?: string
  supersededBy?: string
  replaces?: string
}

interface KnowledgeServer {
  url: string
  rejectedUnauthenticated: () => number
  close: () => Promise<void>
}

/**
 * Start a knowledge server whose records persist in `storePath`, so a restart
 * reloads the same knowledge instead of an empty fixture.
 */
async function startKnowledgeServer(storePath: string, port = 0): Promise<KnowledgeServer> {
  let rejected = 0
  let sequence = 0
  const load = async (): Promise<KnowledgeRecord[]> => {
    try {
      return JSON.parse(await readFile(storePath, 'utf8')) as KnowledgeRecord[]
    } catch {
      return []
    }
  }
  const handler = createMcpHandler(() => {
    const mcp = new McpServer(
      { name: 'garden-knowledge', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    mcp.registerTool('store_candidate', {
      description: 'Store a provisional candidate.',
      inputSchema: z.object({ content: z.string(), project: z.string(), scope: z.enum(['project', 'global']).optional() }),
    }, async (args): Promise<CallToolResult> => {
      const records = await load()
      const record: KnowledgeRecord = {
        id: `mem_${++sequence}`,
        content: args.content,
        project: args.project,
        scope: args.scope ?? 'project',
        status: 'candidate',
      }
      records.push(record)
      await writeFile(storePath, JSON.stringify(records), 'utf8')
      return { content: [{ type: 'text', text: JSON.stringify(record) }] }
    })
    mcp.registerTool('search', {
      description: 'Search knowledge visible to one project.',
      inputSchema: z.object({ project: z.string(), query: z.string().optional() }),
    }, async (args): Promise<CallToolResult> => {
      const records = await load()
      // Project scope plus explicitly global records; another project's
      // project-scoped knowledge is never returned.
      const visible = records.filter(record => record.scope === 'global' || record.project === args.project)
      return { content: [{ type: 'text', text: JSON.stringify(visible) }] }
    })
    mcp.registerTool('verify', {
      description: 'Promote a candidate to verified.',
      inputSchema: z.object({ id: z.string() }),
    }, async (args): Promise<CallToolResult> => {
      const records = await load()
      const record = records.find(entry => entry.id === args.id)
      if (record === undefined) return { content: [{ type: 'text', text: 'not found' }], isError: true }
      record.status = 'verified'
      await writeFile(storePath, JSON.stringify(records), 'utf8')
      return { content: [{ type: 'text', text: JSON.stringify(record) }] }
    })
    mcp.registerTool('mark_stale', {
      description: 'Mark knowledge stale without deleting it.',
      inputSchema: z.object({ id: z.string(), reason: z.string() }),
    }, async (args): Promise<CallToolResult> => {
      const records = await load()
      const record = records.find(entry => entry.id === args.id)
      if (record === undefined) return { content: [{ type: 'text', text: 'not found' }], isError: true }
      record.status = 'stale'
      record.staleReason = args.reason
      await writeFile(storePath, JSON.stringify(records), 'utf8')
      return { content: [{ type: 'text', text: JSON.stringify(record) }] }
    })
    mcp.registerTool('supersede', {
      description: 'Supersede knowledge with a replacement, preserving history.',
      inputSchema: z.object({ id: z.string(), replacement: z.string() }),
    }, async (args): Promise<CallToolResult> => {
      const records = await load()
      const record = records.find(entry => entry.id === args.id)
      if (record === undefined) return { content: [{ type: 'text', text: 'not found' }], isError: true }
      const replacement: KnowledgeRecord = {
        id: `mem_${++sequence}`,
        content: args.replacement,
        project: record.project,
        scope: record.scope,
        status: 'candidate',
      }
      // The old record stays present and links forward; nothing disappears.
      record.status = 'superseded'
      record.supersededBy = replacement.id
      replacement.replaces = record.id
      records.push(replacement)
      await writeFile(storePath, JSON.stringify(records), 'utf8')
      return { content: [{ type: 'text', text: JSON.stringify({ superseded: record, replacement }) }] }
    })
    return mcp
  })
  const handle = toNodeHandler(handler)
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    // Authentication is enforced before the MCP handler sees the request.
    if (request.headers.authorization !== TOKEN) {
      rejected += 1
      response.writeHead(401).end('unauthorized')
      return
    }
    handle(request as NodeIncomingMessageLike, response).catch((error: unknown) => {
      response.writeHead(500).end(String(error))
    })
  })
  const listening: PromiseWithResolvers<void> = Promise.withResolvers()
  server.listen(port, '127.0.0.1', listening.resolve)
  await listening.promise
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('knowledge server has no TCP address')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    rejectedUnauthenticated: () => rejected,
    close: async () => {
      await handler.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      })
    },
  }
}

/** One independent DSH client process-equivalent pointed at the shared server. */
async function connectClient(url: string, tokenVariable: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(mcpClient, {
    transport: 'streamable-http',
    serverName: 'knowledge',
    url,
    headers: {},
    headerEnv: { Authorization: tokenVariable },
    toolCallTimeoutMs: 10_000,
    failOnStartupError: true,
    reconnect: { initialDelayMs: 50, maxDelayMs: 200, maxAttempts: 30 },
  })
  return ctx
}

async function mintAgentScope(ctx: Context, name: string): Promise<{ scope: Scope; key: Agent }> {
  const key = { id: name as SessionId } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) },
    { inject: ['tools', 'systemPrompt'] }))
  return { scope, key }
}

async function call(ctx: Context, name: string, args: Record<string, unknown>, agent: Agent): Promise<string> {
  const result = await ctx.tools.execute({
    signal: testToolSignal, callId: ToolCallId('c1'), name, arguments: args, agent,
  })
  const first = result.content[0]
  return first?.type === 'text' ? first.text : JSON.stringify(result.content)
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  delete process.env.GARDEN_KNOWLEDGE_TOKEN
})

describe('shared knowledge across clients', () => {
  it('lets client B retrieve a candidate client A stored', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-lan-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
    const server = await startKnowledgeServer(join(dir, 'knowledge.json'))
    cleanups.push(server.close)
    process.env.GARDEN_KNOWLEDGE_TOKEN = TOKEN

    const clientA = await connectClient(server.url, 'GARDEN_KNOWLEDGE_TOKEN')
    const clientB = await connectClient(server.url, 'GARDEN_KNOWLEDGE_TOKEN')
    const agentA = await mintAgentScope(clientA, 'a')
    const agentB = await mintAgentScope(clientB, 'b')

    const stored = JSON.parse(await call(clientA, 'mcp__knowledge__store_candidate',
      { content: 'Ingress rollback uses the previous Helm revision.', project: 'project-a' }, agentA.key)) as KnowledgeRecord
    expect(stored.id).toBe('mem_1')

    const seen = JSON.parse(await call(clientB, 'mcp__knowledge__search',
      { project: 'project-a' }, agentB.key)) as KnowledgeRecord[]
    expect(seen.map(record => record.content)).toContain('Ingress rollback uses the previous Helm revision.')
  })

  it('does not leak one project\'s knowledge into another project', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-scope-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
    const server = await startKnowledgeServer(join(dir, 'knowledge.json'))
    cleanups.push(server.close)
    process.env.GARDEN_KNOWLEDGE_TOKEN = TOKEN

    const client = await connectClient(server.url, 'GARDEN_KNOWLEDGE_TOKEN')
    const agent = await mintAgentScope(client, 'a')
    await call(client, 'mcp__knowledge__store_candidate',
      { content: 'Project A private decision.', project: 'project-a' }, agent.key)

    const other = JSON.parse(await call(client, 'mcp__knowledge__search',
      { project: 'project-b' }, agent.key)) as KnowledgeRecord[]
    expect(other).toEqual([])
  })

  it('returns global knowledge to any project when explicitly requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-global-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
    const server = await startKnowledgeServer(join(dir, 'knowledge.json'))
    cleanups.push(server.close)
    process.env.GARDEN_KNOWLEDGE_TOKEN = TOKEN

    const client = await connectClient(server.url, 'GARDEN_KNOWLEDGE_TOKEN')
    const agent = await mintAgentScope(client, 'a')
    await call(client, 'mcp__knowledge__store_candidate',
      { content: 'Organization-wide convention.', project: 'project-a', scope: 'global' }, agent.key)

    const seen = JSON.parse(await call(client, 'mcp__knowledge__search',
      { project: 'project-b' }, agent.key)) as KnowledgeRecord[]
    expect(seen.map(record => record.content)).toContain('Organization-wide convention.')
  })

  it('keeps knowledge when a client restarts and a new client retrieves it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-restart-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
    const server = await startKnowledgeServer(join(dir, 'knowledge.json'))
    cleanups.push(server.close)
    process.env.GARDEN_KNOWLEDGE_TOKEN = TOKEN

    const first = await connectClient(server.url, 'GARDEN_KNOWLEDGE_TOKEN')
    const agentFirst = await mintAgentScope(first, 'a')
    const stored = JSON.parse(await call(first, 'mcp__knowledge__store_candidate',
      { content: 'Durable knowledge across restarts.', project: 'project-a' }, agentFirst.key)) as KnowledgeRecord

    // The client restarts: a fresh client process against the same server.
    await first.fiber.dispose()
    const clientC = await connectClient(server.url, 'GARDEN_KNOWLEDGE_TOKEN')
    const agentC = await mintAgentScope(clientC, 'c')

    const seen = JSON.parse(await call(clientC, 'mcp__knowledge__search',
      { project: 'project-a' }, agentC.key)) as KnowledgeRecord[]
    expect(seen.map(record => record.id)).toContain(stored.id)
  })

  it('reconnects a client after the knowledge service restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-svc-restart-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
    const storePath = join(dir, 'knowledge.json')
    // A fixed port lets the restarted service answer on the same URL.
    const first = await startKnowledgeServer(storePath)
    const port = Number(new URL(first.url).port)
    process.env.GARDEN_KNOWLEDGE_TOKEN = TOKEN

    const client = await connectClient(first.url, 'GARDEN_KNOWLEDGE_TOKEN')
    const agent = await mintAgentScope(client, 'a')
    await call(client, 'mcp__knowledge__store_candidate',
      { content: 'Survives a service restart.', project: 'project-a' }, agent.key)

    await first.close()
    const second = await startKnowledgeServer(storePath, port)
    cleanups.push(second.close)

    // The supervisor reconnects and re-syncs tools without a new client.
    await expect.poll(async () => {
      try {
        const seen = JSON.parse(await call(client, 'mcp__knowledge__search',
          { project: 'project-a' }, agent.key)) as KnowledgeRecord[]
        return seen.map(record => record.content)
      } catch {
        return []
      }
    }, { timeout: 15_000, interval: 200 }).toContain('Survives a service restart.')
  })

  it('refuses to open an unauthenticated connection when the credential is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-auth-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
    const server = await startKnowledgeServer(join(dir, 'knowledge.json'))
    cleanups.push(server.close)

    // No credential variable is set, so the entry must fail rather than send
    // an unauthenticated request to a LAN knowledge service.
    const anonymous = new Context()
    await anonymous.plugin(SystemPrompt, {})
    await anonymous.plugin(ToolRuntime)
    const failure = await anonymous.plugin(mcpClient, {
      transport: 'streamable-http',
      serverName: 'knowledge',
      url: server.url,
      headers: {},
      headerEnv: { Authorization: 'GARDEN_KNOWLEDGE_TOKEN' },
      toolCallTimeoutMs: 5_000,
      failOnStartupError: true,
      reconnect: { enabled: false },
    }).then(() => undefined, (error: unknown) => error as Error)

    expect(failure).toBeDefined()
    expect(String(failure?.cause)).toMatch(/GARDEN_KNOWLEDGE_TOKEN/)

    // The unauthenticated request never left the client.
    expect(server.rejectedUnauthenticated()).toBe(0)
  })
})

describe('knowledge lifecycle', () => {
  /** Mount a worker and a supervisor over one shared server. */
  async function lifecyclePair(storePath: string) {
    const server = await startKnowledgeServer(storePath)
    cleanups.push(server.close)
    process.env.GARDEN_KNOWLEDGE_TOKEN = TOKEN
    const ctx = await connectClient(server.url, 'GARDEN_KNOWLEDGE_TOKEN')
    const worker = await mintAgentScope(ctx, 'worker')
    const supervisor = await mintAgentScope(ctx, 'supervisor')
    const privileged = ['mcp__knowledge__verify', 'mcp__knowledge__mark_stale', 'mcp__knowledge__supersede']
    worker.scope.ctx.tools.restrict({ deny: privileged })
    return { ctx, worker: worker.key, supervisor: supervisor.key }
  }

  it('carries a candidate through retrieval, verification, staleness, and supersession', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-lifecycle-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
    const { ctx, worker, supervisor } = await lifecyclePair(join(dir, 'knowledge.json'))

    // Agent A stores a candidate.
    const stored = JSON.parse(await call(ctx, 'mcp__knowledge__store_candidate',
      { content: 'Ingress rollback uses the previous Helm revision.', project: 'project-a' }, worker)) as KnowledgeRecord
    expect(stored.status).toBe('candidate')

    // Agent B retrieves the candidate and sees it is not yet verified.
    const found = JSON.parse(await call(ctx, 'mcp__knowledge__search',
      { project: 'project-a' }, worker)) as KnowledgeRecord[]
    expect(found[0]?.status).toBe('candidate')

    // The worker cannot self-certify its own finding.
    expect(await call(ctx, 'mcp__knowledge__verify', { id: stored.id }, worker)).toMatch(/unknown tool/)

    // The supervisor verifies it.
    const verified = JSON.parse(await call(ctx, 'mcp__knowledge__verify',
      { id: stored.id }, supervisor)) as KnowledgeRecord
    expect(verified.status).toBe('verified')

    // Agent C retrieves the verified knowledge.
    const afterVerify = JSON.parse(await call(ctx, 'mcp__knowledge__search',
      { project: 'project-a' }, worker)) as KnowledgeRecord[]
    expect(afterVerify[0]?.status).toBe('verified')

    // The source changes, so the supervisor marks the record stale.
    const stale = JSON.parse(await call(ctx, 'mcp__knowledge__mark_stale',
      { id: stored.id, reason: 'runbook rewritten upstream' }, supervisor)) as KnowledgeRecord
    expect(stale.status).toBe('stale')

    // A replacement claim supersedes it, and history is preserved.
    const superseded = JSON.parse(await call(ctx, 'mcp__knowledge__supersede',
      { id: stored.id, replacement: 'Ingress rollback now drains connections first.' }, supervisor)) as {
      superseded: KnowledgeRecord
      replacement: KnowledgeRecord
    }
    expect(superseded.superseded.status).toBe('superseded')
    expect(superseded.replacement.replaces).toBe(stored.id)
    expect(superseded.superseded.supersededBy).toBe(superseded.replacement.id)

    // The old knowledge did not silently disappear.
    const all = JSON.parse(await call(ctx, 'mcp__knowledge__search',
      { project: 'project-a' }, worker)) as KnowledgeRecord[]
    expect(all.map(record => record.id)).toContain(stored.id)
    expect(all.map(record => record.id)).toContain(superseded.replacement.id)
  })

  it('keeps every privileged lifecycle tool out of a worker\'s reach', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-authority-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
    const { ctx, worker } = await lifecyclePair(join(dir, 'knowledge.json'))

    for (const tool of ['verify', 'mark_stale', 'supersede']) {
      expect(await call(ctx, `mcp__knowledge__${tool}`, { id: 'mem_1' }, worker)).toMatch(/unknown tool/)
    }
    // Retrieval and candidate submission stay available to the worker.
    expect(await call(ctx, 'mcp__knowledge__search', { project: 'project-a' }, worker)).not.toMatch(/unknown tool/)
  })
})
