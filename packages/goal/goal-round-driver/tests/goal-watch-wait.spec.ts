import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import GoalService from '@deepseek-ai/dsh-goal'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
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

async function harness(script: StreamChunk[][], jobs: ToolJobs.Config = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(LocalJobRegistry, {})
  await ctx.plugin(ToolJobs, jobs)
  await ctx.plugin(GoalService)
  await ctx.plugin(goalSession)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId(`goal-watch-${Math.random()}`), {
    provider: 'mock',
    model: 'mock',
  })
  return { ctx, adapter, agent }
}

function pendingWatch(ctx: Context, owner: SessionId) {
  let settle!: (outcome: JobOutcome) => void
  const id = ctx.jobs.start({
    kind: 'watch',
    label: 'ci on PR 123',
    owner,
    run: () => ({
      cancel: () => {},
      done: new Promise<JobOutcome>((resolve) => { settle = resolve }),
    }),
  })
  return { id, settle: (outcome: JobOutcome) => { settle(outcome) } }
}

async function pause(ms: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, ms))
}

describe('goal rounds while a watch is pending', () => {
  it('holds rounds while a watch polls and resumes once its notice wakes the agent', async () => {
    const test = await harness([textResponse('noted the wait'), textResponse('round one')])
    const watch = pendingWatch(test.ctx, test.agent.id)
    test.ctx.goals.create(test.agent, { objective: 'wait for ci', maxGoalRounds: 1 })
    await pause(100)
    expect(test.adapter.requests).toHaveLength(0)
    watch.settle({ status: 'completed', detail: 'condition met: exit code 0', result: 'Condition met after 1 checks.' })
    await vi.waitFor(() => { expect(test.adapter.requests).toHaveLength(2) })
    expect(JSON.stringify(test.adapter.requests[1])).toContain('Round: 1/1')
  })

  it('resumes rounds when the settlement notice is only injected and wakes nobody', async () => {
    const test = await harness([textResponse('round one')], { completionDelivery: 'quiet' })
    const watch = pendingWatch(test.ctx, test.agent.id)
    test.ctx.goals.create(test.agent, { objective: 'wait for ci', maxGoalRounds: 1 })
    await pause(100)
    expect(test.adapter.requests).toHaveLength(0)
    watch.settle({ status: 'completed', detail: 'condition met: exit code 0', result: 'Condition met after 1 checks.' })
    await vi.waitFor(() => { expect(test.adapter.requests).toHaveLength(1) })
    expect(JSON.stringify(test.adapter.requests[0])).toContain('Round: 1/1')
  })

  it('does not hold rounds for a watch that is already stopping', async () => {
    const test = await harness([textResponse('acknowledged'), textResponse('round one')])
    const watch = pendingWatch(test.ctx, test.agent.id)
    test.ctx.goals.create(test.agent, { objective: 'wait for ci', maxGoalRounds: 1 })
    await pause(100)
    expect(test.adapter.requests).toHaveLength(0)
    expect(test.ctx.jobs.kill(watch.id, test.agent.id, 'no longer needed')).toBe('requested')
    test.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'status?' }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(test.adapter.requests).toHaveLength(2) })
    expect(JSON.stringify(test.adapter.requests[1])).toContain('Round: 1/1')
    watch.settle({ status: 'killed' })
  })
})
