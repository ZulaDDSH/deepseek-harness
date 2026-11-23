/** Input landing after the final inbox check must still run. */
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
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

const message = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

describe('driver retirement window', () => {
  it.each(['inject', 'steer'] as const)('%s landing after the final inbox check still runs', async (method) => {
    const adapter = new MockAdapter([textResponse('first'), textResponse('second')])
    const ctx = await harness(adapter)
    const agent: Agent = await ctx.agentLoop.create(brandString<SessionId>(`retire-${method}`), { provider: 'mock', model: 'mock' })
    let late = false
    ctx.on('session/event', (session, event) => {
      if (session !== agent.session || event.type !== 'turn/end' || late) return
      late = true
      queueMicrotask(() => agent[method](message('late')))
    })

    agent.followup(message('first'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    expect(agent.inbox.hasPending).toBe(false)
    expect(agent.session.snapshotEvents().filter(e => e.type === 'user/message').flatMap(e => e.type === 'user/message' ? e.data.content : []).map(c => c.type === 'text' ? c.text : '')).toEqual(['first', 'late'])
  })
})
