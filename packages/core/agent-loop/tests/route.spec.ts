import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const INITIAL = { provider: 'mock', model: 'initial' }
const PICKED = { provider: 'mock', model: 'picked' }
const ROUTED = { provider: 'mock', model: 'routed' }

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function prompt(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('agent/route step selection', () => {
  it('runs the captured selection when no listener routes the step', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('no-route'), INITIAL)
    agent.followup(prompt('hi'))
    await agent.whenIdle()
    expect(adapter.requests[0]).toMatchObject(INITIAL)
    expect(agent.session.requestHeader()?.config).toMatchObject(INITIAL)
  })

  it('fails the step when neither the Agent nor a route names a selection', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    const agent = await ctx.agentLoop.create(SessionId('no-selection'))
    agent.followup(prompt('hi'))
    await agent.whenIdle()
    expect(errors).toEqual([expect.objectContaining({ message: expect.stringContaining('has no provider/model') as string })])
  })

  it('runs a routed step on its selection, leaves the pending pick, and records the route as the last request', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const routed: unknown[] = []
    const preStepSelections: unknown[] = []
    ctx.on('agent/route', async ({ turn, step, messages }) => {
      routed.push({ turn, step, messages: messages.map(message => message.id) })
      return ROUTED
    })
    ctx.on('agent/pre-step', async ({ modelSelection }, next) => {
      preStepSelections.push(modelSelection)
      return next()
    })
    const agent = await ctx.agentLoop.create(SessionId('routed'), INITIAL)
    agent.model.select(PICKED)
    const message = prompt('hi')
    agent.followup(message)
    await agent.whenIdle()

    expect(routed).toEqual([{ turn: 1, step: 1, messages: [message.id] }])
    expect(preStepSelections).toEqual([ROUTED])
    expect(adapter.requests[0]).toMatchObject(ROUTED)
    expect(agent.model.current()).toEqual(PICKED)
    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'model/selection').map(event => event.data)).toEqual([PICKED])
    expect(agent.session.requestHeader()?.config).toMatchObject(ROUTED)
    expect(ctx.sessionProjections.snapshot(agent.session).values.modelSelection).toEqual({
      lastUsed: ROUTED,
      lastUsedSeq: events.filter(event => event.type === 'request/header').at(-1)?.seq,
      next: PICKED,
    })
  })

  it('leaves a step the listener does not route on the captured selection', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(adapter)
    ctx.on('agent/route', async ({ turn }) => (turn === 1 ? ROUTED : undefined))
    const agent = await ctx.agentLoop.create(SessionId('partial'), INITIAL)
    agent.model.select(PICKED)
    agent.followup(prompt('first'))
    await agent.whenIdle()
    agent.followup(prompt('second'))
    await agent.whenIdle()
    expect(adapter.requests.map(request => [request.provider, request.model])).toEqual([
      [ROUTED.provider, ROUTED.model],
      [PICKED.provider, PICKED.model],
    ])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'request/header')).toHaveLength(2)
    expect(agent.session.requestHeader()?.config).toMatchObject(PICKED)
    expect(agent.model.current()).toEqual(PICKED)
  })

  it('keeps the selection captured by the send that woke the driver when a pick follows it', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('captured'), INITIAL)
    agent.followup(prompt('hi'))
    agent.model.select(PICKED)
    await agent.whenIdle()
    expect(adapter.requests[0]).toMatchObject(INITIAL)
    expect(agent.model.current()).toEqual(PICKED)
  })

  it('lets a route supply the selection for an Agent that names none', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    ctx.on('agent/route', async () => ROUTED)
    const agent = await ctx.agentLoop.create(SessionId('routed-only'))
    agent.followup(prompt('hi'))
    await agent.whenIdle()
    expect(adapter.requests[0]).toMatchObject(ROUTED)
  })

  it('runs a pinned selection ahead of any route and never consults the listener', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const routed: unknown[] = []
    ctx.on('agent/route', async () => {
      routed.push(ROUTED)
      return ROUTED
    })
    const agent = await ctx.agentLoop.create(SessionId('pinned'), { ...INITIAL, pinnedSelection: () => PICKED })
    agent.followup(prompt('hi'))
    await agent.whenIdle()
    expect(routed).toEqual([])
    expect(adapter.requests[0]).toMatchObject(PICKED)
  })
})
