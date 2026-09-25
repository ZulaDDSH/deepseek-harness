import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { installMcpSelectionProjection } from '../src/mcp-selection-projection.ts'
import { installModelSelectionProjection } from '../src/model-selection-projection.ts'
import { installSessionReadTestServices } from './test-remote.ts'

const roots: Context[] = []
const testToolSignal = new AbortController().signal

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/**
 * Mount the controller the way the shipped composition does: Tools is provided
 * by a sibling entry, so `ctx.tools` is not reachable from the controller's
 * injection chain and only `ctx.get('tools')` resolves it.
 */
async function harness(): Promise<{ ctx: Context; agents: ApiSessionAgentController }> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  installSessionReadTestServices(ctx)
  installModelSelectionProjection(ctx)
  installMcpSelectionProjection(ctx)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)
  await ctx.plugin(ToolRuntime)
  let agents: ApiSessionAgentController | undefined
  await ctx.plugin(Object.assign((inner: Context) => { agents = new ApiSessionAgentController(inner) }, {
    // The production `inject` list, minus the services these paths never read.
    // `tools` is deliberately absent: the controller must not require it.
    inject: ['typert', 'agentDefaultModel', 'sessions', 'agents', 'sessionProjections', 'sessionQuery'],
  }))
  if (agents === undefined) throw new Error('the Session Controller did not load')
  return { ctx, agents }
}

function connectorTool(name: string) {
  return defineContentToolFixture({
    name,
    description: name,
    parameters: {},
    async execute() { return [{ type: 'text', text: name }] },
  })
}

/** Flatten a tool result's text blocks for an assertion on its message. */
function textOf(result: ToolExecutionResult): string {
  return result.content.map(part => (part as { text?: string }).text ?? '').join('')
}

function agentUnder(ctx: Context, id: string): Agent {
  const meta: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 1,
    isSeeded: false,
    cwd: '/workspace',
  }
  const session = ctx.sessions.create(SessionId(id), { meta })
  const agent = { id: SessionId(id), session, status: 'idle', steer: vi.fn(), followup: vi.fn(), cancel: vi.fn() } as unknown as Agent
  ;(agent as { ctx: Context }).ctx = createScope(ctx, agent).ctx
  return agent
}

describe('MCP connector selection installation', () => {
  it('installs without an injected tools property on the controller context', async () => {
    const { ctx, agents } = await harness()
    ctx.tools.register(connectorTool('mcp__console__ping'))
    const agent = agentUnder(ctx, 'mcp-install')
    const { setup } = await agents.composeAgent(undefined)
    expect(() => setup(agent.ctx, agent)).not.toThrow()
  })

  it('denies connectors the Session did not select and keeps the selected one', async () => {
    const { ctx, agents } = await harness()
    ctx.tools.register(connectorTool('mcp__console__ping'))
    ctx.tools.register(connectorTool('mcp__other__probe'))
    const agent = agentUnder(ctx, 'mcp-restrict')
    agent.session.append('mcp/selection', { connectorIds: ['console'] })
    const { setup } = await agents.composeAgent(undefined)
    await setup(agent.ctx, agent)

    const selected = await ctx.tools.execute({
      signal: testToolSignal, callId: ToolCallId('selected'), name: 'mcp__console__ping', arguments: {}, agent,
    })
    const unselected = await ctx.tools.execute({
      signal: testToolSignal, callId: ToolCallId('unselected'), name: 'mcp__other__probe', arguments: {}, agent,
    })
    expect(selected.isError).toBe(false)
    expect(unselected.isError).toBe(true)
    expect(textOf(unselected)).toContain('MCP connector is not enabled for this Session')
  })
})
