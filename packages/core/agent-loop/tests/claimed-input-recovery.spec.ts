import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { type SessionEvent, type SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter) {
  const ctx = new Context()
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

function prompt(text: string, source: 'user' | 'test' = 'user'): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: source === 'user' ? { kind: 'user' } : { kind: 'test' } })
}

function events(agent: Agent): readonly SessionEvent[] {
  return agent.session.snapshotEvents()
}

function admittedTexts(agent: Agent): string[] {
  return events(agent)
    .filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
    .flatMap(event => event.type === 'user/message' ? event.data.content.map(block => block.type === 'text' ? block.text : '') : [])
}

function pendingTexts(agent: Agent): string[] {
  return [...agent.inbox.nextTurn, ...agent.inbox.nextStep]
    .flatMap(message => message.content.map(block => block.type === 'text' ? block.text : ''))
}

function collectErrors(ctx: Context): unknown[] {
  const errors: unknown[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(error) })
  return errors
}

describe('claimed input recovery', () => {
  it('restores a claimed prompt when route resolution fails before admission', async () => {
    const adapter = new MockAdapter([textResponse('should not run')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(brandString<SessionId>('route-failure'), { provider: 'mock', model: 'mock' })
    const errors = collectErrors(ctx)
    ctx.on('agent/route', async () => { throw new Error('route failed') })

    agent.followup(prompt('keep me'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(0)
    expect(admittedTexts(agent)).toEqual([])
    expect(pendingTexts(agent)).toEqual(['keep me'])
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain('route failed')
  })

  it('restores a claimed prompt when system prompt assembly fails and the restored prompt runs on the next wake', async () => {
    const adapter = new MockAdapter([textResponse('first reply'), textResponse('second reply')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(brandString<SessionId>('assemble-failure'), { provider: 'mock', model: 'mock' })
    const errors = collectErrors(ctx)
    const assemble = vi.spyOn(ctx.systemPrompt, 'assemble').mockRejectedValueOnce(new Error('assemble failed'))

    agent.followup(prompt('first'))
    await agent.whenIdle()
    expect(assemble).toHaveBeenCalledTimes(1)
    expect(adapter.requests).toHaveLength(0)
    expect(pendingTexts(agent)).toEqual(['first'])
    expect(errors).toHaveLength(1)

    agent.followup(prompt('second'))
    await agent.whenIdle()

    expect(admittedTexts(agent)).toEqual(['first', 'second'])
    expect(pendingTexts(agent)).toEqual([])
    expect(adapter.requests).toHaveLength(2)
  })

  it('restores a claimed prompt when a pre-step listener throws', async () => {
    const adapter = new MockAdapter([textResponse('should not run')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(brandString<SessionId>('pre-step-throw'), { provider: 'mock', model: 'mock' })
    collectErrors(ctx)
    ctx.on('agent/pre-step', async (): Promise<PreStepDecision> => { throw new Error('hook failed') })

    agent.followup(prompt('hook input'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(0)
    expect(admittedTexts(agent)).toEqual([])
    expect(pendingTexts(agent)).toEqual(['hook input'])
  })

  it('restores a claimed prompt when request preparation fails before admission', async () => {
    const adapter = new MockAdapter([textResponse('should not run')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(brandString<SessionId>('request-prep-failure'), { provider: 'mock', model: 'mock' })
    collectErrors(ctx)
    ctx.on('agent/request', async () => { throw new Error('request preparation failed') })

    agent.followup(prompt('prepared input'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(0)
    expect(admittedTexts(agent)).toEqual([])
    expect(events(agent).some(event => event.type === 'user/message')).toBe(false)
    expect(pendingTexts(agent)).toEqual(['prepared input'])
  })

  it('restores a claimed prompt when a step boundary append fails before admission', async () => {
    const adapter = new MockAdapter([textResponse('should not run')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(brandString<SessionId>('step-append-failure'), { provider: 'mock', model: 'mock' })
    collectErrors(ctx)
    const append = agent.session.append.bind(agent.session) as (...args: unknown[]) => unknown
    vi.spyOn(agent.session, 'append').mockImplementation(((type: string, ...rest: unknown[]) => {
      if (type === 'step/start') throw new Error('step/start append failed')
      return append(type, ...rest)
    }) as never)

    agent.followup(prompt('stored later'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(0)
    expect(admittedTexts(agent)).toEqual([])
    expect(pendingTexts(agent)).toEqual(['stored later'])
  })

  it('discards a claimed prompt explicitly when the turn is cancelled during pre-step', async () => {
    const adapter = new MockAdapter([textResponse('should not run')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(brandString<SessionId>('cancel-pre-step'), { provider: 'mock', model: 'mock' })
    const discarded: string[] = []
    ctx.on('agent/inbox/discarded', ({ message }) => { discarded.push(...message.content.map(block => block.type === 'text' ? block.text : '')) })
    const entered = Promise.withResolvers<void>()
    const decision = Promise.withResolvers<PreStepDecision>()
    ctx.on('agent/pre-step', () => {
      entered.resolve()
      return decision.promise
    })

    agent.followup(prompt('cancelled input'))
    await entered.promise
    agent.cancel({ kind: 'user' })
    decision.resolve({ kind: 'enter', messages: [] })
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(0)
    expect(admittedTexts(agent)).toEqual([])
    expect(pendingTexts(agent)).toEqual([])
    expect(discarded).toEqual(['cancelled input'])
    expect(events(agent).filter(event => event.type === 'turn/end').map(event => event.type === 'turn/end' && event.data.reason))
      .toEqual([{ kind: 'aborted', reason: { kind: 'user' } }])
  })

  it('discards a claimed prompt explicitly when pre-step rejects it and records the blocked turn', async () => {
    const adapter = new MockAdapter([textResponse('should not run')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(brandString<SessionId>('reject-discards'), { provider: 'mock', model: 'mock' })
    const discarded: string[] = []
    ctx.on('agent/inbox/discarded', ({ message }) => { discarded.push(...message.content.map(block => block.type === 'text' ? block.text : '')) })
    ctx.on('agent/pre-step', async (): Promise<PreStepDecision> => ({ kind: 'reject' }))

    agent.followup(prompt('rejected input'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(0)
    expect(events(agent).some(event => event.type === 'user/message')).toBe(false)
    expect(events(agent).filter(event => event.type === 'turn/end').map(event => event.type === 'turn/end' && event.data.reason))
      .toEqual([{ kind: 'blocked' }])
    expect(discarded).toEqual(['rejected input'])
    expect(pendingTexts(agent)).toEqual([])
  })

  it('discards a prompt that keeps failing before admission after a bounded number of restores', async () => {
    const adapter = new MockAdapter([textResponse('healthy reply')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(brandString<SessionId>('bounded-restore'), { provider: 'mock', model: 'mock' })
    const errors = collectErrors(ctx)
    const discarded: string[] = []
    ctx.on('agent/inbox/discarded', ({ message }) => { discarded.push(...message.content.map(block => block.type === 'text' ? block.text : '')) })
    ctx.on('agent/pre-step', async ({ messages }, next) => {
      if (messages.some(message => message.content.some(block => block.type === 'text' && block.text === 'poison'))) throw new Error('hook failed')
      return next()
    })

    agent.followup(prompt('poison'))
    for (const wake of ['wake 1', 'wake 2']) {
      await agent.whenIdle()
      expect(pendingTexts(agent)[0]).toBe('poison')
      expect(discarded).toEqual([])
      agent.followup(prompt(wake))
    }
    await agent.whenIdle()
    expect(pendingTexts(agent)).toEqual(['poison', 'wake 1', 'wake 2'])
    expect(discarded).toEqual([])
    agent.followup(prompt('wake 3'))
    await agent.whenIdle()

    expect(discarded).toEqual(['poison'])
    expect(pendingTexts(agent)).not.toContain('poison')
    expect(errors).toHaveLength(4)
    expect(String(errors[3])).toContain('Discarded 1 claimed input message(s)')
    expect(admittedTexts(agent)).toEqual([])

    agent.followup(prompt('wake 4'))
    await agent.whenIdle()
    expect(admittedTexts(agent)).toContain('wake 1')
  })

  it('forgets the restore count of a restored prompt that is removed from the inbox', async () => {
    const adapter = new MockAdapter([textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(brandString<SessionId>('restore-count-removed'), { provider: 'mock', model: 'mock' })
    collectErrors(ctx)
    const discarded: string[] = []
    ctx.on('agent/inbox/discarded', ({ message }) => { discarded.push(...message.content.map(block => block.type === 'text' ? block.text : '')) })
    ctx.on('agent/pre-step', async ({ messages }, next) => {
      if (messages.some(message => message.content.some(block => block.type === 'text' && block.text === 'poison'))) throw new Error('hook failed')
      return next()
    })
    const poison = prompt('poison')

    agent.followup(poison)
    await agent.whenIdle()
    agent.followup(prompt('wake 1'))
    await agent.whenIdle()
    agent.inbox.clear()
    discarded.length = 0

    agent.followup(poison)
    await agent.whenIdle()
    agent.followup(prompt('wake 2'))
    await agent.whenIdle()

    expect(discarded).toEqual([])
    expect(pendingTexts(agent)).toEqual(['poison', 'wake 2'])
  })

  it('does not restore input after admission, even when the step later fails', async () => {
    const adapter = new MockAdapter([textResponse('should not run')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(brandString<SessionId>('admitted-then-failed'), { provider: 'mock', model: 'mock' })
    const errors = collectErrors(ctx)
    ctx.on('llm/stream', () => { throw new Error('stream failed after admission') })

    agent.followup(prompt('admitted once'))
    await agent.whenIdle()

    expect(admittedTexts(agent)).toEqual(['admitted once'])
    expect(pendingTexts(agent)).toEqual([])
    expect(errors).toHaveLength(1)
  })

  it('leaves a hook-rewritten empty admission as an intentional drop', async () => {
    const adapter = new MockAdapter([textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(brandString<SessionId>('hook-drop'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/pre-step', async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] }))

    agent.followup(prompt('dropped by hook'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(0)
    expect(pendingTexts(agent)).toEqual([])
    expect(admittedTexts(agent)).toEqual([])
  })
})
