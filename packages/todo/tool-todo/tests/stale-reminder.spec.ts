import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as ToolTodo from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

async function run(script: ReturnType<typeof toolCallResponse>[]): Promise<Agent> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
  ctx.llm.registerAdapter(['mock'], new MockAdapter([...script, textResponse('done')]))
  const agent = await ctx.agentLoop.create(SessionId('stale-todo'), { provider: 'mock', model: 'mock' })
  const idle = new Promise<void>((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status }) => { if (s === agent && status === 'idle') { d(); resolve() } }) })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await idle
  return agent
}

const plan = { todos: [{ content: 'Build', status: 'in_progress' }] }
const probes = (n: number, from = 0) => Array.from({ length: n }, (_, i) => toolCallResponse(`p${from + i}`, 'probe', {}))
const reminders = (agent: Agent) => agent.session.snapshotEvents()
  .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message' && e.data.source.kind === 'repeat-tool-reminder')

describe('stale todo reminder', () => {
  it('reminds after six tool calls without a todo_write while work remains', async () => {
    const agent = await run([toolCallResponse('w', 'todo_write', plan), ...probes(6)])
    expect(reminders(agent)).toHaveLength(1)
  })

  it('stays quiet when todo_write resets the count or the list is finished', async () => {
    const reset = await run([toolCallResponse('w', 'todo_write', plan), ...probes(5), toolCallResponse('w2', 'todo_write', plan), ...probes(5, 5)])
    expect(reminders(reset)).toHaveLength(0)
    const finished = await run([toolCallResponse('w', 'todo_write', { todos: [{ content: 'Build', status: 'completed' }] }), ...probes(6)])
    expect(reminders(finished)).toHaveLength(0)
  })
})
