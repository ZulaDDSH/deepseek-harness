import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'

const STEER_NOTE = '(wait ended early: a new message from the user arrived; the background job was not stopped)'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
})

async function setup(config: ToolJobs.Config = {}): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalJobRegistry, {})
  await ctx.plugin(ToolJobs, config)
  return ctx
}

type AgentFake = Partial<Omit<Agent, 'session' | 'inbox'>> & { session?: Partial<Agent['session']>; inbox?: Partial<Agent['inbox']> }
function agentFake(fields: AgentFake): Agent { return fields as Agent }

async function fakeAgent(ctx: Context, sessionId: string, nextStep: UserMessage[] = []): Promise<Agent> {
  const scope = ctx.plugin(() => {})
  const id = SessionId(sessionId)
  const agent = agentFake({
    id,
    ctx: scope.ctx,
    inject: () => {},
    followup: () => {},
    status: 'running',
    session: { id, header: { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false } },
    inbox: { nextStep },
  })
  await ctx.agents.register(agent)
  return agent
}

function startBackgroundJob(ctx: Context, owner: Agent): (outcome: JobOutcome) => void {
  let settle!: (outcome: JobOutcome) => void
  const done = new Promise<JobOutcome>((resolve) => { settle = resolve })
  ctx.jobs.start({ kind: 'bash', label: 'sleep 60', owner: owner.id, run: () => ({ cancel: () => {}, done }) })
  return (outcome) => { settle(outcome) }
}

function waitForJob(ctx: Context, agent: Agent, timeoutMs: number) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`wait-${timeoutMs}-${Math.random()}`),
    name: 'job_output',
    arguments: { job_id: 'bash-1', wait: true, timeout_ms: timeoutMs },
    agent,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function userSteer(content: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text: content }], source: { kind: 'user' } })
}

describe('job_output wait released by a user steer', () => {
  it('ends a blocking wait when a steer reaches the next step, and the job stays alive', async () => {
    const ctx = await setup()
    const nextStep: UserMessage[] = []
    const agent = await fakeAgent(ctx, 'sess-1', nextStep)
    const settle = startBackgroundJob(ctx, agent)
    const pending = waitForJob(ctx, agent, 60_000)
    const steer = userSteer('change of plans')
    nextStep.push(steer)
    emitAgentEvent(ctx, agent, 'agent/inbox/inserted', { message: steer })

    expect(text(await pending)).toBe(`${STEER_NOTE}\n[status: running]`)
    nextStep.length = 0
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message: steer, turn: 1 })
    const again = waitForJob(ctx, agent, 60_000)
    settle({ status: 'completed' })
    expect(text(await again)).toBe('(no new output)\n[status: completed]')
  })

  it('never cancels the job: output keeps accumulating and a later job_output returns it', async () => {
    const ctx = await setup()
    const nextStep: UserMessage[] = []
    const agent = await fakeAgent(ctx, 'sess-1', nextStep)
    let cancels = 0
    let append!: (chunk: string) => void
    let settle!: (outcome: JobOutcome) => void
    const done = new Promise<JobOutcome>((resolve) => { settle = resolve })
    ctx.jobs.start({
      kind: 'bash',
      label: 'sleep 60',
      owner: agent.id,
      run: (job) => {
        append = (chunk) => { job.append(chunk) }
        return { cancel: () => { cancels += 1 }, done }
      },
    })
    append('before\n')
    const pending = waitForJob(ctx, agent, 60_000)
    const steer = userSteer('hold on')
    nextStep.push(steer)
    emitAgentEvent(ctx, agent, 'agent/inbox/inserted', { message: steer })

    expect(text(await pending)).toBe(`before\n${STEER_NOTE}\n[status: running]`)
    expect(cancels).toBe(0)
    expect(ctx.jobs.list(agent.id).map(job => job.status)).toEqual(['running'])

    append('after\n')
    settle({ status: 'completed' })
    nextStep.length = 0
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message: steer, turn: 1 })
    expect(text(await waitForJob(ctx, agent, 60_000))).toBe('after\n[status: completed]')
    expect(cancels).toBe(0)
  })

  it('returns at once when a steer is already pending for the caller', async () => {
    const ctx = await setup()
    const nextStep: UserMessage[] = []
    const agent = await fakeAgent(ctx, 'sess-1', nextStep)
    const settle = startBackgroundJob(ctx, agent)
    const steer = userSteer('streamed while the step was running')
    nextStep.push(steer)
    emitAgentEvent(ctx, agent, 'agent/inbox/inserted', { message: steer })

    expect(text(await waitForJob(ctx, agent, 60_000))).toBe(`${STEER_NOTE}\n[status: running]`)
    settle({ status: 'completed' })
  })

  it('no longer releases waits once the steer is claimed into a step', async () => {
    const ctx = await setup()
    const nextStep: UserMessage[] = []
    const agent = await fakeAgent(ctx, 'sess-1', nextStep)
    const settle = startBackgroundJob(ctx, agent)
    const steer = userSteer('claimed at the boundary')
    nextStep.push(steer)
    emitAgentEvent(ctx, agent, 'agent/inbox/inserted', { message: steer })
    nextStep.length = 0
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message: steer, turn: 1 })

    const pending = waitForJob(ctx, agent, 60_000)
    settle({ status: 'completed' })
    expect(text(await pending)).toBe('(no new output)\n[status: completed]')
  })

  it('ignores a queued follow-up and another agent\'s steer', async () => {
    const ctx = await setup()
    const nextStep: UserMessage[] = []
    const agent = await fakeAgent(ctx, 'sess-1', nextStep)
    const otherSteer = userSteer('for the other session')
    const other = await fakeAgent(ctx, 'sess-2', [otherSteer])
    const settle = startBackgroundJob(ctx, agent)
    const pending = waitForJob(ctx, agent, 60_000)

    emitAgentEvent(ctx, other, 'agent/inbox/inserted', { message: otherSteer })
    emitAgentEvent(ctx, agent, 'agent/inbox/inserted', { message: userSteer('queued for the next turn') })
    settle({ status: 'completed' })
    expect(text(await pending)).toBe('(no new output)\n[status: completed]')
  })
})
