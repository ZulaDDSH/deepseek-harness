import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { callSubagent, setup, testToolSignal, text } from './harness.ts'

describe('dsh-tool-subagent background progress', () => {
  /** A live parent whose scope fiber owns structural task cleanup. */
  async function liveParent(ctx: Context, sessionId: string): Promise<Agent> {
    const scopeFiber = ctx.plugin(() => {})
    const id = SessionId(sessionId)
    const parent: Agent = {
      id,
      ctx: scopeFiber.ctx,
      inject: () => {},
      inbox: createInboxStub(),
      options: {},
      session: Session.create(id),
    } as never
    await ctx.agents.register(parent)
    return parent
  }

  async function progressSetup(onStart: (request: SubagentStartRequest) => Promise<void> | void): Promise<Context> {
    const ctx = await setup({ provider: 'mock' }, { reply: 'progress answer', onStart })
    await ctx.plugin(LocalJobRegistry)
    await ctx.plugin(ToolJobs, {})
    return ctx
  }

  it('feeds the provider progress line into the one-shot background job', async () => {
    const requests: SubagentStartRequest[] = []
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    let releaseGate!: () => void
    const gate = new Promise<void>((resolve) => { releaseGate = resolve })
    const ctx = await progressSetup((request) => {
      requests.push(request)
      request.onProgress?.('Edit: src/a.ts')
      markStarted()
      return gate
    })
    const parent = await liveParent(ctx, 'sess-progress')

    const start = await callSubagent(ctx, { description: 'd', prompt: 'p', run_in_background: true }, { agent: parent })
    if (start.isError) throw new Error('expected background subagent success')
    const jobId = (start.value as { jobId: string }).jobId
    expect(text(start)).toBe(`started background subagent job ${jobId}`)
    await started
    expect(ctx.jobs.list(parent.id)).toEqual([expect.objectContaining({ id: jobId, progress: 'Edit: src/a.ts' })])

    releaseGate()
    const collected = await executeToolFixture(ctx, {
      signal: testToolSignal,
      callId: ToolCallId('progress-collect'),
      name: 'job_output',
      arguments: { job_id: jobId, wait: true },
      agent: parent,
    })
    expect(text(collected)).toBe('progress answer\n[status: completed]')
  })

  it('leaves onProgress unset for foreground runs', async () => {
    const requests: SubagentStartRequest[] = []
    const ctx = await progressSetup((request) => { requests.push(request) })
    const parent = await liveParent(ctx, 'sess-foreground')

    const run = await callSubagent(ctx, { description: 'd', prompt: 'p' }, { agent: parent })
    expect(run.isError).toBe(false)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.onProgress).toBeUndefined()
  })
})
