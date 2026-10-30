import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import GoalService from '@deepseek-ai/dsh-goal'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as goalSession from '../src/index.ts'

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.script.shift()
    if (chunks === undefined) throw new Error('ScriptedAdapter: script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

function toolCallResponse(rawCallId: string, name: string, args: object): StreamChunk[] {
  const callId = ToolCallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
})

describe('steering during an active goal round', () => {
  it('delivers a steer queued during a tool call at the next step boundary while the goal is active', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(GoalService)
    await ctx.plugin(goalSession)
    await ctx.plugin(AgentLoop, { agents: [] })
    const adapter = new ScriptedAdapter([
      toolCallResponse('c1', 'slow', {}),
      textResponse('acknowledged the change'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('steer-during-goal'), { provider: 'mock', model: 'mock' })
    const phases: (string | undefined)[] = []
    ctx.tools.register(defineContentToolFixture({
      name: 'slow',
      description: '',
      parameters: {},
      async execute() {
        phases.push(ctx.goals.get(agent)?.phase)
        agent.steer(createUserMessage({ content: [{ type: 'text', text: 'change of plans' }], source: { kind: 'user' } }))
        return [{ type: 'text', text: 'tool done' }]
      },
    }))

    ctx.goals.create(agent, { objective: 'finish the task', maxGoalRounds: 1 })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) }, { timeout: 5_000 })

    expect(phases).toEqual(['active'])
    const events = agent.session.snapshotEvents()
    const steering = events.find(event => event.type === 'user/message'
      && JSON.stringify(event.data.content).includes('change of plans'))
    const secondStep = events.filter(event => event.type === 'step/start')[1]
    expect(steering?.type === 'user/message' && steering.data.source.kind).toBe('user')
    expect(secondStep).toBeDefined()
    expect(steering!.seq).toBeGreaterThan(secondStep!.seq)
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('change of plans')
  })
})
