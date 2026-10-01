import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionToken, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { registerKnowledgeTool } from '../src/tool.ts'
import type { KnowledgePacket, RetrieveOptions } from '../src/types.ts'

const packet: KnowledgePacket = {
  task: 'task',
  providers: ['graphify'],
  unavailable: [],
  items: [],
  bytes: 0,
  truncated: false,
}

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

async function register(retrieve: (task: string, options: RetrieveOptions) => Promise<KnowledgePacket>): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  registerKnowledgeTool(ctx, { retrieve })
  context = ctx
  return ctx
}

describe('knowledge_query', () => {
  it('passes explicit providers and the calling agent into retrieval', async () => {
    let received: { task: string; options: RetrieveOptions } | undefined
    const ctx = await register(async (task, options) => {
      received = { task, options }
      return packet
    })
    const signal = new AbortController().signal
    const exec = {
      signal,
      callId: ToolCallId('knowledge-query-1'),
      name: 'knowledge_query',
      arguments: { task: 'Find prior graph context', providers: ['graphify'] },
    }
    await ctx.tools.execute(exec)
    expect(received?.task).toBe('Find prior graph context')
    expect(received?.options).toMatchObject({
      providers: ['graphify'],
      signal: exec.signal,
    })
    expect(received?.options.execution).toBeDefined()
  })

  it('renders the packet returned by retrieval', async () => {
    const ctx = await register(async () => packet)
    const outcome = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('knowledge-query-render'),
      name: 'knowledge_query',
      arguments: { task: 'task', providers: ['graphify'] },
    })
    expect(outcome.content.map(block => block.type === 'text' ? block.text : '').join('')).toContain('queried: graphify')
  })

  it('forwards a real calling agent to retrieval', async () => {
    let received: RetrieveOptions | undefined
    const ctx = await register(async (_task, options) => {
      received = options
      return packet
    })
    await mountAgentLoopTestHarness(ctx)
    const handle = await ctx.agents.create({
      sessionId: SessionId('knowledge-query-agent'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const callId = ToolCallId('knowledge-query-agent-call')
    const exec: ToolRunContext = {
      callId,
      rootCallId: callId,
      token: Symbol('knowledge-query-agent-call') as ToolExecutionToken,
      name: 'knowledge_query',
      arguments: { task: 'Find prior graph context' },
      agent: handle.agent,
      signal: new AbortController().signal,
      deferContext: () => undefined,
      concludeTurn: () => undefined,
    }
    const definition = ctx.tools.get('knowledge_query')
    if (definition === undefined) throw new Error('knowledge_query was not registered')
    await definition.execute(exec.arguments, exec)
    expect(received?.agent).toBe(handle.agent)
    expect(received?.requestedBy).toBe(String(handle.agent.id))
  })
})
