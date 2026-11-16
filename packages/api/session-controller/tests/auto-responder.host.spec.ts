import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { installRunOptions } from '../src/run-options.ts'
import { autoResponderMessage, AUTO_RESPONDER_MAX_REPLIES, installAutoResponder } from '../src/auto-responder.ts'
import type { SubagentSetup } from '../src/subagent-setup.ts'

const on: SubagentSetup = { enabled: false, reviewRounds: 0, roles: {}, autoResponder: { enabled: true } }

async function boot(script: ConstructorParameters<typeof MockAdapter>[0], setup: SubagentSetup | undefined) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  installRunOptions(ctx)
  ctx.provide('sessionController')
  ctx.set('sessionController', { defaultSubagentSetup: () => setup } as never)
  installAutoResponder(ctx, () => ({ provider: 'mock', model: 'mock' }))
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('auto-responder'), { provider: 'mock', model: 'mock' })
  return { ctx, agent, adapter }
}

function prompt(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user', rpcId: `rpc-${text}` } as never }))
}

async function settle(agent: Agent): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await agent.whenIdle()
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  await agent.whenIdle()
}

const userTexts = (agent: Agent): string[] => agent.session.snapshotEvents()
  .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message' && e.data.source.kind === 'user')
  .map(e => e.data.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(''))

describe('auto responder', () => {
  it('sends the reviewer reply as the next user message, then stops on DONE', async () => {
    const { agent, adapter } = await boot([
      textResponse('part A is done'), textResponse('Now do part B'), textResponse('part B is done'), textResponse('DONE'),
    ], on)
    prompt(agent, 'do A and B')
    await settle(agent)
    expect(userTexts(agent)).toEqual(['do A and B', 'Now do part B'])
    expect(adapter.requests).toHaveLength(4)
    expect(adapter.requests[1]?.system).toContain('auto responder')
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('part A is done')
    expect(agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'user' && 'rpcId' in e.data.source)).toHaveLength(1)
  })

  it('does nothing while the setting is off or absent', async () => {
    for (const setup of [undefined, { ...on, autoResponder: { enabled: false } }, { ...on, autoResponder: undefined }]) {
      const { agent, adapter } = await boot([textResponse('done')], setup)
      prompt(agent, 'go')
      await settle(agent)
      expect(adapter.requests).toHaveLength(1)
      expect(userTexts(agent)).toEqual(['go'])
    }
  })

  it('caps automatic replies after one real prompt', async () => {
    const script = Array.from({ length: AUTO_RESPONDER_MAX_REPLIES + 1 }, (_, i) => [textResponse(`work ${i}`), textResponse(`next ${i}`)]).flat()
    const { agent } = await boot(script, on)
    prompt(agent, 'go')
    await settle(agent)
    expect(userTexts(agent)).toHaveLength(1 + AUTO_RESPONDER_MAX_REPLIES)
  })

  it('leaves the session alone when the review call fails', async () => {
    const { agent } = await boot([textResponse('done'), [{ type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'UNKNOWN' } } }]], on)
    prompt(agent, 'go')
    await settle(agent)
    expect(userTexts(agent)).toEqual(['go'])
  })

  it('stays quiet after a failed turn and for a wake that is not a user prompt', async () => {
    const failed = await boot([[{ type: 'finish', reason: { kind: 'error', failure: { message: 'down', code: 'UNKNOWN' } } }]], on)
    prompt(failed.agent, 'go')
    await settle(failed.agent)
    expect(failed.adapter.requests).toHaveLength(1)
    const woken = await boot([textResponse('tick done')], on)
    woken.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'tick' }], source: { kind: 'hook-reminder' } as never }))
    await settle(woken.agent)
    expect(woken.adapter.requests).toHaveLength(1)
  })

  it('sends only the tail of a very long agent message to the reviewer', async () => {
    const long = `${'x'.repeat(13_000)}END`
    const { agent, adapter } = await boot([textResponse(long), textResponse('DONE')], on)
    prompt(agent, 'go')
    await settle(agent)
    const framed = JSON.stringify(adapter.requests[1]?.messages)
    expect(framed).toContain('END')
    expect(framed.length).toBeLessThan(13_000)
  })

  it('drops a review that a new user prompt overtakes', async () => {
    const { agent, adapter } = await boot([textResponse('first done'), 'hang', textResponse('second done'), textResponse('DONE')], on)
    prompt(agent, 'one')
    for (let i = 0; i < 50 && adapter.requests.length < 2; i += 1) await new Promise(resolve => setTimeout(resolve, 10))
    prompt(agent, 'two')
    await settle(agent)
    expect(userTexts(agent)).toEqual(['one', 'two'])
    expect(adapter.requests).toHaveLength(4)
  })

  it('never reviews a subagent child, and aborts nothing when no review is running', async () => {
    const { ctx } = await boot([], on)
    const child = ctx.sessions.create(SessionId('child'), { meta: { origin: 'subagent' } })
    const followup = vi.fn()
    const fake: Partial<Agent> = { id: SessionId('child'), session: child, status: 'idle', followup }
    ctx.emit('agent/status', { agent: fake as Agent, status: 'idle' })
    ctx.emit('agent/disposed', { agent: fake } as never)
    expect(followup).not.toHaveBeenCalled()
  })

  it('tells the reviewer the agent message is untrusted data', async () => {
    const { agent, adapter } = await boot([textResponse('done'), textResponse('DONE')], on)
    prompt(agent, 'go')
    await settle(agent)
    expect(adapter.requests[1]?.system).toContain('untrusted')
  })

  it('does not review a wake turn that no user message drove', async () => {
    const { agent, adapter } = await boot([textResponse('first'), textResponse('DONE'), textResponse('wake done')], on)
    prompt(agent, 'go')
    await settle(agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'tick' }], source: { kind: 'hook-reminder' } as never }))
    await settle(agent)
    expect(adapter.requests).toHaveLength(3)
  })

  it('skips a turn that produced no agent text', async () => {
    const { agent, adapter } = await boot([textResponse('')], on)
    prompt(agent, 'go')
    await settle(agent)
    expect(adapter.requests).toHaveLength(1)
  })

  it('drops a reply when the setting is switched off during the review', async () => {
    const live = { ...on, autoResponder: { enabled: true } }
    const { ctx, agent, adapter } = await boot([textResponse('half done'), textResponse('Keep going')], live)
    ctx.on('agent/status', ({ status }) => { if (status === 'idle') live.autoResponder = { enabled: false } })
    prompt(agent, 'go')
    await settle(agent)
    expect(adapter.requests).toHaveLength(2)
    expect(userTexts(agent)).toEqual(['go'])
  })

  it('lets the reviewer look up saved memory before it answers', async () => {
    const { ctx, agent, adapter } = await boot([
      textResponse('login fixed'), textResponse('MEMORY: login bug\nignored'), textResponse('Add the regression test'), textResponse('test added'), textResponse('DONE'),
    ], on)
    const lookup = vi.fn((_query: string) => Promise.resolve('Turn 1: login fix'))
    ctx.on('memory/lookup', query => lookup(query))
    prompt(agent, 'fix login')
    await settle(agent)
    expect(lookup).toHaveBeenCalledOnce()
    expect(lookup).toHaveBeenCalledWith('login bug')
    expect(JSON.stringify(adapter.requests[2]?.messages)).toContain('Turn 1: login fix')
    expect(userTexts(agent)).toEqual(['fix login', 'Add the regression test'])
  })

  it('tells the reviewer when no memory provider has notes', async () => {
    const { agent, adapter } = await boot([textResponse('done'), textResponse('MEMORY: anything'), textResponse('DONE')], on)
    prompt(agent, 'go')
    await settle(agent)
    expect(JSON.stringify(adapter.requests[2]?.messages)).toContain('no notes found')
    expect(userTexts(agent)).toEqual(['go'])
  })

  it('stops at two lookups and ignores a blank query', async () => {
    const capped = await boot([textResponse('done'), textResponse('MEMORY: a'), textResponse('MEMORY: b'), textResponse('MEMORY: c')], on)
    const lookup = vi.fn((_query: string) => Promise.resolve('note'))
    capped.ctx.on('memory/lookup', query => lookup(query))
    prompt(capped.agent, 'go')
    await settle(capped.agent)
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(userTexts(capped.agent)).toEqual(['go'])
    const blank = await boot([textResponse('done'), textResponse('MEMORY:  ')], on)
    prompt(blank.agent, 'go')
    await settle(blank.agent)
    expect(blank.adapter.requests).toHaveLength(2)
    expect(userTexts(blank.agent)).toEqual(['go'])
  })

  it('aborts a lookup in flight when a new user prompt arrives', async () => {
    const { ctx, agent } = await boot([textResponse('done'), textResponse('MEMORY: x'), textResponse('again done'), textResponse('DONE')], on)
    let seen: AbortSignal | undefined
    let release = (_notes: string): void => {}
    ctx.on('memory/lookup', (_query, _session, signal) => {
      seen = signal
      return new Promise<string>((resolve) => { release = resolve })
    })
    prompt(agent, 'go')
    for (let round = 0; round < 50 && seen === undefined; round += 1) await new Promise(resolve => setTimeout(resolve, 20))
    expect(seen?.aborted).toBe(false)
    prompt(agent, 'again')
    await settle(agent)
    expect(seen?.aborted).toBe(true)
    release('late note')
    await settle(agent)
    expect(userTexts(agent)).toEqual(['go', 'again'])
  })

  it('maps an empty or DONE reply to no message', () => {
    expect(autoResponderMessage(' done \n')).toBeUndefined()
    expect(autoResponderMessage('')).toBeUndefined()
    expect(autoResponderMessage(' Run the tests ')).toBe('Run the tests')
  })
})
