/**
 * Jev routing across a real parent turn and a real in-process child run. The
 * parent and the child are separate Agents on one mounted loop, so their
 * decisions must be independent, a child's decision must not leak into the
 * parent's in-flight turn, and a later parent turn must decide again.
 *
 * The harness lives here because this package owns the in-process child driver;
 * the router is mounted as a plugin so the assertions read the model route each
 * Agent actually requested.
 */

import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime, { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import * as orchestrationPolicy from '@deepseek-ai/dsh-subagent/orchestration-policy'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as JevRouter from '@deepseek-ai/dsh-llm-jev-router'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { startInProcessRun } from '../src/index.ts'

type Script = ConstructorParameters<typeof MockAdapter>[0]

const ROOT_MODEL = 'mock-root'
const CHILD_MODEL = 'mock-child'
const SECOND_MODEL = 'mock-second'

const ROUTES: JevRouter.JevRoute[] = [
  { id: 'root', provider: 'mock', model: ROOT_MODEL, description: 'The root conversation itself' },
  { id: 'child', provider: 'mock', model: CHILD_MODEL, description: 'One bounded delegated subtask' },
  { id: 'second', provider: 'mock', model: SECOND_MODEL, description: 'A later root turn' },
]

function jevConfig(): JevRouter.Config {
  return {
    enabled: true,
    apiKeyEnv: 'TYPESAFE_API_KEY',
    endpoint: JevRouter.DEFAULT_ENDPOINT,
    model: JevRouter.DEFAULT_MODEL,
    timeoutMs: 1000,
    minConfidence: 0.5,
    stateMaxChars: 12000,
    fallback: 'keep',
    failOpen: true,
    routes: ROUTES,
  }
}

/** Jev's answer is a pure function of the state it is shown, so a test reads the state as the route. */
function routeFor(state: string): string {
  if (state.includes('child task')) return 'child'
  if (state.includes('second question')) return 'second'
  return 'root'
}

function stubJev(decisions: string[]): void {
  vi.stubGlobal('fetch', async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(init?.body as string) as { state: string }
    const choice = routeFor(body.state)
    decisions.push(choice)
    return new Response(JSON.stringify({ answers: { route: { choice, confidence: 0.95 } } }), { status: 200 })
  })
}

function text(blocks: readonly { type: string; text?: string }[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

function systemText(request: GenerateOptions): string {
  const first = request.messages[0]
  if (first?.role !== 'system') throw new Error('the loop-built request has no leading system message')
  return text(first.content)
}

async function setup(script: Script) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, adapter }
}

function childRequest(parent: Agent, signal = new AbortController().signal) {
  return {
    label: 'child task',
    prompt: [{ type: 'text' as const, text: 'child task' }],
    parent,
    signal,
    descriptor: snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'test', label: 'child task' }),
  }
}

/** Run one child to completion from inside a parent tool call. */
function registerDelegate(ctx: Context, parent: Agent): () => void {
  return ctx.tools.register(defineContentToolFixture({
    name: 'delegate',
    description: 'Delegate one bounded subtask to a child agent.',
    parameters: {},
    async execute() {
      const run = await startInProcessRun(childRequest(parent), {})
      try {
        const result = await run.result
        return result.output
      } finally {
        await run.dispose()
      }
    },
  }))
}

async function ask(agent: Agent, question: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: question }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Jev routing across a parent and its in-process child', () => {
  it('decides each Agent from its own state and re-decides on a later parent turn', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
    const decisions: string[] = []
    stubJev(decisions)
    const { ctx, parent, adapter } = await setup([
      toolCallResponse('t1', 'delegate', {}),
      textResponse('child answer'),
      textResponse('parent final'),
      textResponse('second final'),
    ])
    await ctx.plugin(JevRouter, jevConfig())
    const disposeDelegate = registerDelegate(ctx, parent)

    await ask(parent, 'parent question')
    await ask(parent, 'second question')

    // The parent's step 1 delegates, the child runs inside that tool call, the
    // parent finishes the same turn, and only then does a second turn start.
    expect(adapter.requests.map(request => request.model))
      .toEqual([ROOT_MODEL, CHILD_MODEL, ROOT_MODEL, SECOND_MODEL])
    expect(decisions).toEqual(['root', 'child', 'root', 'second'])
    disposeDelegate()
  })

  it('renders the orchestration policy into the root request only', async () => {
    const { ctx, parent, adapter } = await setup([
      toolCallResponse('t1', 'delegate', {}),
      textResponse('child answer'),
      textResponse('parent final'),
    ])
    await ctx.plugin(orchestrationPolicy)
    const disposeDelegate = registerDelegate(ctx, parent)

    await ask(parent, 'parent question')

    expect(systemText(adapter.requests[0]!)).toContain('You are the root agent for this session')
    expect(systemText(adapter.requests[0]!)).toContain("A delegate inherits this agent's provider, model, and reasoning effort")
    expect(systemText(adapter.requests[1]!)).not.toContain('You are the root agent for this session')
    disposeDelegate()
  })
})
