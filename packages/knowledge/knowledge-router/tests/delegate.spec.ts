/**
 * Assisted-mode delegation: the worker starts with the bounded packet, the
 * child is continuable, and a task that warrants no knowledge gets the plain
 * task text instead of empty scaffolding.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import KnowledgeRouter from '../src/index.ts'

/** One delegation the stub subagent service observed. */
interface Captured {
  readonly provider: string
  readonly label: string
  readonly prompt: string
  readonly maxDepth?: number
}

/** A subagent service that records what it was asked to start. */
class StubSubagents extends Service {
  readonly captured: Captured[] = []

  constructor(ctx: Context) {
    super(ctx, 'subagents')
  }

  resolveMaxDepth(): number | undefined { return 4 }

  startContinuable(spec: {
    provider: string
    label: string
    request: { prompt: { type: string; text: string }[]; maxDepth?: number }
  }): Promise<{ childId: SessionId; messageId: MessageId }> {
    this.captured.push({
      provider: spec.provider,
      label: spec.label,
      prompt: spec.request.prompt.map(block => block.text).join(''),
      ...spec.request.maxDepth !== undefined ? { maxDepth: spec.request.maxDepth } : {},
    })
    return Promise.resolve({ childId: SessionId('child-1'), messageId: MessageId('message-1') })
  }
}

class UnboundedStubSubagents extends StubSubagents {
  override resolveMaxDepth(): undefined { return undefined }
}

/** A stand-in for one MCP server tool. */
function stubTool(name: string, respond: string): ToolDefinition {
  return {
    name,
    description: `stub for ${name}`,
    parameters: { type: 'object' },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    execute: async () => respond,
  }
}

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/** One mounted composition: the stub subagent service and a delegating agent. */
interface Mounted {
  readonly stub: StubSubagents
  readonly agent: Agent
}

/** Mount the router beside a stub subagent service and one production Agent. */
async function mount(mode: 'manual' | 'assisted', unbounded = false): Promise<Mounted> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(unbounded ? UnboundedStubSubagents : StubSubagents)
  await ctx.plugin(KnowledgeRouter, { mode, gitnexus: { enabled: true }, graphify: { enabled: true } })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('parent-1'))
  context = ctx
  return { stub: ctx.subagents as unknown as StubSubagents, agent }
}

/** Dispatch the delegation tool as the delegating agent. */
function delegate(task: string, agent: Agent): Promise<{ isError: boolean; value?: unknown }> {
  const ctx = context as Context
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('delegate-1'),
    name: 'knowledge_delegate',
    arguments: { description: 'Investigate the race', prompt: task },
    agent,
  })
}

/** Register both provider stubs. */
function registerProviders(): void {
  context?.tools.register(stubTool('mcp__gitnexus__query', 'CODE for the race'))
  context?.tools.register(stubTool('mcp__graphify__query_graph', 'NODE race learning=preferred'))
}

describe('assisted-mode delegation', () => {
  it('is registered only in assisted mode', async () => {
    const { agent } = await mount('manual')
    expect(context?.tools.get('knowledge_delegate', agent)).toBeUndefined()
    expect(context?.tools.get('knowledge_query', agent)).toBeDefined()
  })

  it('starts a continuable worker whose prompt carries only the routed packet', async () => {
    const { stub, agent } = await mount('assisted')
    registerProviders()

    const result = await delegate('Investigate this recurring race and propose a fix.', agent)

    expect(result.isError).toBe(false)
    expect(stub.captured).toHaveLength(1)
    expect(stub.captured[0]?.provider).toBe('spawn')
    expect(stub.captured[0]?.label).toBe('Investigate the race')
    const prompt = stub.captured[0]?.prompt ?? ''
    expect(prompt).toContain('TASK')
    expect(prompt).toContain('CODE INTELLIGENCE')
    expect(prompt).toContain('CODE for the race')
    expect(prompt).toContain('LEARNED CONTEXT')
    expect(prompt).toContain('NODE race learning=preferred')
  })

  it('queries only the provider the task warrants', async () => {
    const { stub, agent } = await mount('assisted')
    registerProviders()

    await delegate('What calls Session::close?', agent)

    const prompt = stub.captured[0]?.prompt ?? ''
    expect(prompt).toContain('CODE for the race')
    expect(prompt).not.toContain('NODE race learning=preferred')
  })

  it('passes the plain task when no knowledge provider is available', async () => {
    const { stub, agent } = await mount('assisted')
    await delegate('Investigate this recurring race and propose a fix.', agent)
    expect(stub.captured[0]?.prompt).toBe('Investigate this recurring race and propose a fix.')
  })

  it('reports the child id the caller can reuse for follow-up', async () => {
    const { stub, agent } = await mount('assisted')
    context?.tools.register(stubTool('mcp__gitnexus__query', 'CODE'))
    const result = await delegate('What calls Session::close?', agent)
    expect(result.value).toMatchObject({ childId: 'child-1', providers: ['gitnexus'], unavailable: [] })
    expect(stub.captured).toHaveLength(1)
  })

  it('rejects a call without a delegating agent', async () => {
    await mount('assisted')
    const result = await context?.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('delegate-without-agent'),
      name: 'knowledge_delegate',
      arguments: { description: 'Investigate the race', prompt: 'Investigate this recurring race.' },
    })
    expect(result?.isError).toBe(true)
    expect(JSON.stringify(result?.content)).toContain('requires a delegating agent')
  })

  it('omits an unavailable worker depth limit', async () => {
    const { stub, agent } = await mount('assisted', true)
    await delegate('Investigate this recurring race.', agent)
    expect(stub.captured).toHaveLength(1)
    expect(stub.captured[0]?.maxDepth).toBeUndefined()
  })
})
