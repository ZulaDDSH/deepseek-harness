/**
 * Router behavior against a real tool registry: provider isolation, bounded
 * routing, and tolerance of a provider that fails.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import KnowledgeRouter, { resolveConfig } from '../src/index.ts'
import { renderPacket } from '../src/packet.ts'

/** A stand-in for one MCP server tool. */
function stubTool(name: string, respond: string | (() => Promise<string> | string)): ToolDefinition {
  return {
    name,
    description: `stub for ${name}`,
    parameters: { type: 'object' },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    execute: async () => (typeof respond === 'function' ? await respond() : respond),
  }
}

/** Mount a registry plus the router under test. */
async function mount(config: Parameters<typeof KnowledgeRouter.Config>[0]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(KnowledgeRouter, config)
  return ctx
}

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

const signal = (): AbortSignal => new AbortController().signal

describe('provider isolation', () => {
  it('resolves explicit bounds and defaults for enabled features', () => {
    expect(resolveConfig({
      gitnexus: { enabled: true, serverName: 'code', limit: 2, maxSymbols: 3 },
      graphify: { enabled: true, serverName: 'memory', depth: 4, tokenBudget: 800 },
      learning: { enabled: true },
      delegation: { provider: 'fork' },
      maxPacketBytes: 900,
    })).toEqual({
      mode: 'off',
      providers: { gitnexus: 'code', graphify: 'memory' },
      maxPacketBytes: 900,
      gitnexusLimit: 2,
      gitnexusMaxSymbols: 3,
      graphifyDepth: 4,
      graphifyTokenBudget: 800,
      learning: { command: 'graphify', reflect: true },
      delegationProvider: 'fork',
    })
    expect(resolveConfig({ learning: { enabled: true, memoryDir: '/memory' } }).learning).toEqual({
      command: 'graphify', memoryDir: '/memory', reflect: true,
    })
  })

  it('reports a task routing decision through the service', async () => {
    context = await mount({ mode: 'manual' })
    expect(context.knowledge.route('What calls Session::close?')).toEqual(['gitnexus'])
  })

  it('rejects a provider identity outside the closed provider set', async () => {
    context = await mount({ mode: 'manual' })
    const queryArguments = (context.knowledge as unknown as {
      queryArguments(provider: string, task: string): Record<string, string | number>
    }).queryArguments.bind(context.knowledge)
    expect(() => queryArguments('unknown', 'task')).toThrow(/knowledge provider/)
  })

  it('does not query a disabled provider whose MCP tool is registered', async () => {
    context = await mount({ mode: 'manual' })
    context.tools.register(stubTool('mcp__graphify__query_graph', 'DISABLED'))
    const packet = await context.knowledge.retrieve('Earlier findings', { providers: ['graphify'], signal: signal() })
    expect(packet.providers).toEqual([])
    expect(packet.unavailable).toEqual(['graphify'])
    expect(packet.items).toEqual([])
  })

  it('keeps nested provider calls under the model-requested call', async () => {
    context = await mount({ mode: 'manual', gitnexus: { enabled: true } })
    let root: unknown
    const tool = stubTool('mcp__gitnexus__query', 'CODE')
    tool.execute = async (_args, execution) => { root = execution.rootCallId; return 'CODE' }
    context.tools.register(tool)
    const callId = ToolCallId('knowledge-query-root')
    await context.tools.execute({ callId, name: 'knowledge_query', arguments: { task: 'What calls close?' }, signal: signal() })
    expect(root).toBe(callId)
  })

  it('starts with neither provider enabled', async () => {
    context = await mount({ mode: 'manual' })
    expect(context.knowledge.status().map(status => status.enabled)).toEqual([false, false])
  })

  it('enables GitNexus alone', async () => {
    context = await mount({ mode: 'manual', gitnexus: { enabled: true } })
    context.tools.register(stubTool('mcp__gitnexus__query', 'CODE'))
    expect(context.knowledge.status()).toEqual([
      { provider: 'gitnexus', enabled: true, serverName: 'gitnexus', connected: true, tools: ['query'] },
      { provider: 'graphify', enabled: false, serverName: '', connected: false, tools: [] },
    ])
  })

  it('enables Graphify alone', async () => {
    context = await mount({ mode: 'manual', graphify: { enabled: true } })
    context.tools.register(stubTool('mcp__graphify__query_graph', 'LESSON'))
    const statuses = context.knowledge.status()
    expect(statuses[0]?.connected).toBe(false)
    expect(statuses[1]).toMatchObject({ provider: 'graphify', connected: true, tools: ['query_graph'] })
  })

  it('enables both together', async () => {
    context = await mount({ mode: 'manual', gitnexus: { enabled: true }, graphify: { enabled: true } })
    context.tools.register(stubTool('mcp__gitnexus__query', 'CODE'))
    context.tools.register(stubTool('mcp__graphify__query_graph', 'LESSON'))
    expect(context.knowledge.status().map(status => status.connected)).toEqual([true, true])
  })

  it('registers no knowledge tool while the mode is off', async () => {
    context = await mount({})
    expect(context.tools.get('knowledge_query')).toBeUndefined()
  })

  it('registers the knowledge tool in manual mode', async () => {
    context = await mount({ mode: 'manual' })
    expect(context.tools.get('knowledge_query')).toBeDefined()
  })
})

describe('routing through the registry', () => {
  it('queries GitNexus alone for a call-chain question', async () => {
    context = await mount({ mode: 'assisted', gitnexus: { enabled: true }, graphify: { enabled: true } })
    context.tools.register(stubTool('mcp__gitnexus__query', 'CODE'))
    context.tools.register(stubTool('mcp__graphify__query_graph', 'LESSON'))
    const packet = await context.knowledge.retrieve('What calls Session::close?', { signal: signal() })
    expect(packet.providers).toEqual(['gitnexus'])
    expect(packet.items).toHaveLength(1)
    expect(packet.items[0]?.text).toBe('CODE')
    expect(packet.unavailable).toEqual([])
  })

  it('queries Graphify alone for a past-attempt question', async () => {
    context = await mount({ mode: 'assisted', gitnexus: { enabled: true }, graphify: { enabled: true } })
    context.tools.register(stubTool('mcp__gitnexus__query', 'CODE'))
    context.tools.register(stubTool('mcp__graphify__query_graph', 'LESSON'))
    const packet = await context.knowledge.retrieve('Did we try fixing this race before?', { signal: signal() })
    expect(packet.providers).toEqual(['graphify'])
    expect(packet.items[0]?.text).toBe('LESSON')
  })

  it('queries both providers, each bounded, for a complex debugging task', async () => {
    context = await mount({ mode: 'assisted', gitnexus: { enabled: true }, graphify: { enabled: true } })
    context.tools.register(stubTool('mcp__gitnexus__query', 'CODE'))
    context.tools.register(stubTool('mcp__graphify__query_graph', 'LESSON'))
    const packet = await context.knowledge.retrieve('Investigate this recurring race and propose a fix.', { signal: signal() })
    expect(packet.providers).toEqual(['gitnexus', 'graphify'])
    const rendered = renderPacket(packet)
    expect(rendered).toContain('CODE INTELLIGENCE')
    expect(rendered).toContain('LEARNED CONTEXT')
  })

  it('retrieves nothing for a task that names no cue', async () => {
    context = await mount({ mode: 'assisted', gitnexus: { enabled: true }, graphify: { enabled: true } })
    context.tools.register(stubTool('mcp__gitnexus__query', 'CODE'))
    context.tools.register(stubTool('mcp__graphify__query_graph', 'LESSON'))
    const packet = await context.knowledge.retrieve('Write a haiku about the ocean', { signal: signal() })
    expect(packet.providers).toEqual([])
    expect(packet.items).toEqual([])
  })

  it('honours an explicit provider list over routing', async () => {
    context = await mount({ mode: 'manual', gitnexus: { enabled: true }, graphify: { enabled: true } })
    context.tools.register(stubTool('mcp__graphify__query_graph', 'LESSON'))
    const packet = await context.knowledge.retrieve('What calls Session::close?', {
      providers: ['graphify'],
      signal: signal(),
    })
    expect(packet.providers).toEqual(['graphify'])
  })
})

describe('provider failure', () => {
  it('joins only text blocks and probes Graphify freshness without failing retrieval', async () => {
    context = await mount({
      mode: 'manual',
      graphify: { enabled: true },
      learning: { enabled: true, command: 'dsh-knowledge-router-missing-graphify' },
    })
    context.tools.register({
      name: 'mcp__graphify__query_graph',
      description: 'fixture with text and a non-text block',
      parameters: { type: 'object' },
      output: {
        schema: { type: 'string' },
        render: () => [
          { type: 'text', text: 'NODE closeSession() [src=session.ts loc=L1] learning=preferred' },
          { type: 'reasoning', text: 'private reasoning block' },
        ],
      },
      execute: async () => 'ignored',
    })
    const packet = await context.knowledge.retrieve('Did we try fixing this race before?', {
      providers: ['graphify'], signal: signal(),
    })
    expect(packet.items[0]?.text).toBe('NODE closeSession() [src=session.ts loc=L1] learning=preferred')
    expect(packet.items[0]?.freshness).toEqual({ kind: 'current' })
  })

  it('does not probe Graphify when its output contains no node label', async () => {
    context = await mount({
      mode: 'manual',
      graphify: { enabled: true },
      learning: { enabled: true, memoryDir: '/memory' },
    })
    context.tools.register(stubTool('mcp__graphify__query_graph', 'No matching nodes found.'))
    const packet = await context.knowledge.retrieve('Did we try fixing this race before?', {
      providers: ['graphify'], signal: signal(),
    })
    expect(packet.items[0]?.freshness).toEqual({ kind: 'unknown' })
  })

  it('reports an enabled provider whose query tool is missing as unavailable', async () => {
    context = await mount({ mode: 'assisted', gitnexus: { enabled: true }, graphify: { enabled: true } })
    const packet = await context.knowledge.retrieve('What calls Session::close?', { signal: signal() })
    expect(packet.providers).toEqual([])
    expect(packet.unavailable).toEqual(['gitnexus'])
  })

  it('continues when a provider call fails, surfacing the failure text', async () => {
    context = await mount({ mode: 'assisted', gitnexus: { enabled: true } })
    context.tools.register(stubTool('mcp__gitnexus__query', () => { throw new Error('provider down') }))
    const packet = await context.knowledge.retrieve('What calls Session::close?', { signal: signal() })
    expect(packet.providers).toEqual(['gitnexus'])
    expect(packet.items[0]?.text).toContain('provider down')
    expect(packet.items[0]?.freshness).toEqual({ kind: 'unknown' })
  })

  it('surfaces a Graphify stale marker rather than presenting it as current', async () => {
    context = await mount({ mode: 'assisted', graphify: { enabled: true } })
    context.tools.register(stubTool('mcp__graphify__query_graph', 'NODE a learning=preferred:stale'))
    const packet = await context.knowledge.retrieve('Did we try fixing this race before?', { signal: signal() })
    expect(packet.items[0]?.freshness.kind).toBe('stale')
    expect(renderPacket(packet)).toContain('STALE - REVERIFY')
  })
})

describe('learning write-back wiring', () => {
  it('registers no write-back tool by default', async () => {
    context = await mount({ mode: 'assisted' })
    expect(context.tools.get('knowledge_record')).toBeUndefined()
  })

  it('registers the write-back tool only when learning is enabled', async () => {
    context = await mount({ mode: 'assisted', learning: { enabled: true } })
    expect(context.tools.get('knowledge_record')).toBeDefined()
  })

  it('refuses a write when write-back is not configured', async () => {
    context = await mount({ mode: 'assisted' })
    await expect(context.knowledge.learn(
      { question: 'Q', answer: 'A', outcome: 'useful', validatedBy: 'reviewer' },
      signal(),
    )).rejects.toThrow(/not configured/)
  })

  it('surfaces a failing provider command as a failed call rather than a silent success', async () => {
    context = await mount({ mode: 'assisted', learning: { enabled: true, command: 'dsh-knowledge-router-missing-graphify' } })
    const result = await context.tools.execute({
      signal: signal(),
      callId: ToolCallId('record-1'),
      name: 'knowledge_record',
      arguments: { question: 'Q', answer: 'A', outcome: 'useful', validated_by: 'reviewer' },
    })
    expect(result.isError).toBe(true)
  })
})
