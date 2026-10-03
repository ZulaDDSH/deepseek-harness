/**
 * The assisted-mode delegation loop against real services: the worker
 * `knowledge_delegate` starts is a genuine continuable child, so the existing
 * control tools reach it — the worker can report to its parent, and the parent
 * can send a correction back to that same child.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as control from '@deepseek-ai/dsh-tool-subagent-control'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import KnowledgeRouter from '../src/index.ts'

const signal = new AbortController().signal
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

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

let calls = 0

/** One settled tool call, including the model-facing content of a failure. */
interface CallOutcome {
  readonly isError: boolean
  readonly value?: unknown
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
}

/** Dispatch one tool call through the registry. */
function callTool(ctx: Context, name: string, args: unknown, agent?: unknown): Promise<CallOutcome> {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`call-${++calls}`),
    name,
    arguments: args,
    ...agent !== undefined ? { agent: agent as never } : {},
  })
}

/** Join the text blocks of one settled call. */
function text(outcome: CallOutcome): string {
  return (outcome.content ?? []).map(block => block.type === 'text' ? block.text ?? '' : '').join('\n')
}

/** Boot the composition: real subagents, real control tools, the router, one scripted model. */
async function setup(options: { learning?: boolean; maxDepth?: number } = {}): Promise<{
  ctx: Context
  parent: { id: SessionId }
  adapter: MockAdapter
}> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-knowledge-delegate-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime, { maxDepth: options.maxDepth ?? 4 })
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(control)
  await ctx.plugin(KnowledgeRouter, {
    mode: 'assisted',
    gitnexus: { enabled: true },
    delegation: { provider: 'spawn' },
    ...options.learning === true ? { learning: { enabled: true, command: 'graphify' } } : {},
  })
  const adapter = new MockAdapter([textResponse('child finding'), textResponse('child follow-up')])
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  // The stand-in parent's own turns are not scripted; only delivery is asserted.
  ctx.on('agent/pre-step', async ({ agent: subject }, next) =>
    subject.id === parent.id ? { kind: 'reject' as const } : next())
  return { ctx, parent, adapter }
}

describe('the delegated worker is reachable through the control tools', () => {
  it('refuses delegation when the configured depth cap is reached', async () => {
    const { ctx, parent, adapter } = await setup({ maxDepth: 0 })
    const result = await callTool(ctx, 'knowledge_delegate', { description: 'Depth limit', prompt: 'Inspect code' }, parent)
    expect(result.isError).toBe(true)
    expect(adapter.requests).toEqual([])
  })

  it('carries the packet into the child and relays a correction back to that same child', async () => {
    const { ctx, parent, adapter } = await setup()
    ctx.tools.register(stubTool('mcp__gitnexus__query', 'CODE for the race'))

    const delegated = await callTool(ctx, 'knowledge_delegate', {
      description: 'Investigate the race',
      prompt: 'Investigate this recurring race and propose a fix.',
    }, parent)
    expect(delegated.isError).toBe(false)
    const childId = (delegated.value as { childId: SessionId }).childId

    // The worker's own model request is where the packet has to land.
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const childRequest = JSON.stringify(adapter.requests[0])
    expect(childRequest).toContain('CODE INTELLIGENCE')
    expect(childRequest).toContain('CODE for the race')

    const child = ctx.agents.get(childId)
    if (child === undefined) throw new Error('expected a live worker')

    const toParent: unknown[] = []
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (agent === parent && message.source.kind === 'agent-message') toParent.push(message)
    })
    const relayed = await callTool(ctx, 'send_message', { agent_id: parent.id, message: 'CHILD_FINDING' }, child)
    expect(relayed.isError).toBe(false)
    await vi.waitFor(() => { expect(toParent).toHaveLength(1) })

    const toChild: Array<{ source: unknown }> = []
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (agent.id === childId && message.source.kind === 'agent-message') toChild.push({ source: message.source })
    })
    const corrected = await callTool(ctx, 'send_message', { agent_id: childId, message: 'CORRECTION' }, parent)
    expect(corrected.isError).toBe(false)
    await vi.waitFor(() => { expect(toChild).toHaveLength(1) })
    expect(toChild[0]?.source).toMatchObject({ kind: 'agent-message', senderSessionId: parent.id })
  }, 30_000)
})

describe('a delegated worker cannot promote its own finding', () => {
  it('denies the learning write to the worker through the executor and keeps it for the parent', async () => {
    const { ctx, parent } = await setup({ learning: true })
    const delegated = await callTool(ctx, 'knowledge_delegate', {
      description: 'Investigate the race',
      prompt: 'Investigate this recurring race and propose a fix.',
    }, parent)
    expect(delegated.isError).toBe(false)

    const child = ctx.agents.get((delegated.value as { childId: SessionId }).childId)
    if (child === undefined) throw new Error('expected a live worker')

    const denied = await callTool(ctx, 'knowledge_record', {
      question: 'What closes a Session?',
      answer: 'The worker claims it is close().',
      outcome: 'useful',
      validated_by: 'the worker itself',
    }, child)

    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('delegated worker may not record learned knowledge')
    expect(ctx.tools.get('knowledge_record', parent)).toBeDefined()
  }, 30_000)
})
