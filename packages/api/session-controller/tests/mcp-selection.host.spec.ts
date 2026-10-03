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
import { SessionCommandController } from '../src/commands.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { installMcpSelectionProjection } from '../src/mcp-selection-projection.ts'
import { installModelSelectionProjection } from '../src/model-selection-projection.ts'
import { createSessionTestController, installSessionReadTestServices } from './test-remote.ts'

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
async function harness(withTools = true): Promise<{ ctx: Context; agents: ApiSessionAgentController }> {
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
  if (withTools) await ctx.plugin(ToolRuntime)
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
  const rejectInboxMutation = (): never => { throw new Error('this fixture does not mutate the inbox') }
  const agent: Agent = {
    id: SessionId(id), session, options: {}, ctx, status: 'idle',
    inbox: {
      nextTurn: [], nextStep: [], append: rejectInboxMutation, prepend: rejectInboxMutation,
      replace: rejectInboxMutation, remove: rejectInboxMutation, splice: rejectInboxMutation, clear: rejectInboxMutation,
    },
    steer: vi.fn(), followup: vi.fn(), cancel: vi.fn(), send: vi.fn(), inject: vi.fn(),
    whenIdle: () => Promise.resolve(), runMaintenance: task => task(new AbortController().signal),
  }
  Object.assign(agent, { ctx: createScope(ctx, agent).ctx })
  return agent
}

describe('MCP connector selection installation', () => {
  it('excludes newly connected tools and server instructions and blocks resource reads from disabled connectors', async () => {
    const { ctx, agents } = await harness()
    ctx.tools.register(connectorTool('mcp__console__ping'))
    ctx.tools.register(defineContentToolFixture({
      name: 'read_mcp_resource', description: 'Read resource',
      parameters: { server: { type: 'string', required: true } },
      async execute() { return [{ type: 'text', text: 'resource' }] },
    }))
    ctx.systemPrompt.section({ name: 'mcp:console', order: 1, text: 'Selected instructions' })
    ctx.systemPrompt.section({ name: 'mcp:other', order: 2, text: 'Disabled instructions' })
    ctx.systemPrompt.section({ name: 'mcp-resource-servers', order: 3, text: 'console, other' })
    const agent = agentUnder(ctx, 'mcp-late')
    agents.installMcpSelection(agent, { connectorIds: ['console'] })
    ctx.tools.register(connectorTool('mcp__other__late'))
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.map(tool => tool.name)).not.toContain('mcp__other__late')
    expect(assembly.sections.map(section => section.name)).toContain('mcp:console')
    expect(assembly.sections.map(section => section.name)).not.toContain('mcp:other')
    const denied = await ctx.tools.execute({
      signal: testToolSignal, callId: ToolCallId('resource-other'), name: 'read_mcp_resource',
      arguments: { server: 'other' }, agent,
    })
    expect(denied.isError).toBe(true)
    const allowed = await ctx.tools.execute({
      signal: testToolSignal, callId: ToolCallId('resource-console'), name: 'read_mcp_resource',
      arguments: { server: 'console' }, agent,
    })
    expect(allowed.isError).toBe(false)
    ctx.provide('ptcRuntime', {
      language: 'typescript',
      resolve: () => { throw new Error('This fixture only assembles prompts') },
      run: () => { throw new Error('This fixture only assembles prompts') },
    } as never)
    agent.ctx.get('tools')!.presentAs('both')
    ctx.tools.register(connectorTool('mcp__other__later'))
    const hybrid = await ctx.systemPrompt.assemble({ scope: agent })
    const sdk = hybrid.sections.find(section => section.name === 'tools:sdk')?.text
    expect(sdk).toContain('mcp__console__ping')
    expect(sdk).not.toContain('mcp__other__later')
    expect(hybrid.sections.map(section => section.name)).not.toContain('mcp-resource-servers')
  })
  it('exposes connector discovery and normalized selection through the Session controller', async () => {
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.tools.register(connectorTool('mcp__console__ping'))
    const controller = createSessionTestController(ctx, {
      defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }), cwd: '/workspace',
    })
    const agent = agentUnder(ctx, 'mcp-facade')
    await ctx.agents.register(agent)
    expect(controller.listMcpConnectors()).toEqual({ connectorIds: ['console'] })
    await expect(controller.selectMcp({ sessionId: agent.id, connectorIds: ['console', 'console'] }))
      .resolves.toEqual({ selected: { connectorIds: ['console'] } })
    await expect(controller.selectMcp({ sessionId: agent.id, connectorIds: ['missing'] }))
      .rejects.toMatchObject({ code: 'gateway/bad-request', message: 'unknown MCP connector: missing' })
  })

  it('preserves remote errors and reports non-Error selection failures', async () => {
    const { ctx, agents } = await harness()
    const agent = agentUnder(ctx, 'mcp-errors')
    await ctx.agents.register(agent)
    const commands = new SessionCommandController(ctx, agents, '/workspace')
    const failure = new RemoteError('gateway/internal', 'selection unavailable', {})
    const select = vi.spyOn(agents, 'selectMcpFor').mockImplementationOnce(() => { throw failure })
    await expect(commands.selectMcp({ sessionId: agent.id, connectorIds: [] })).rejects.toBe(failure)
    select.mockImplementationOnce(() => { throw 'offline' })
    await expect(commands.selectMcp({ sessionId: agent.id, connectorIds: [] }))
      .rejects.toMatchObject({ code: 'gateway/bad-request', message: 'offline' })
  })

  it('lists unique connector namespaces and rejects unknown selections without recording them', async () => {
    const { ctx, agents } = await harness()
    for (const name of ['mcp__zeta__ping', 'mcp__alpha__ping', 'mcp__alpha__probe', 'local', 'mcp____invalid', 'mcp__incomplete']) {
      ctx.tools.register(connectorTool(name))
    }
    expect(agents.listMcpConnectorIds()).toEqual(['alpha', 'zeta'])
    const agent = agentUnder(ctx, 'mcp-normalize')
    expect(() => { agents.selectMcpFor(agent, { connectorIds: ['missing'] }) }).toThrow('unknown MCP connector: missing')
    expect(agents.mcpSelectionFor(agent.session)).toBeNull()
    agents.selectMcpFor(agent, { connectorIds: ['zeta', 'alpha', 'zeta'] })
    expect(agents.mcpSelectionFor(agent.session)).toEqual({ connectorIds: ['alpha', 'zeta'] })
  })

  it('records selections when the tool registry is absent', async () => {
    const { ctx, agents } = await harness(false)
    const agent = agentUnder(ctx, 'mcp-no-tools')
    expect(agents.listMcpConnectorIds()).toEqual([])
    agents.installMcpSelection(agent, null)
    agents.selectMcpFor(agent, { connectorIds: [] })
    expect(agents.mcpSelectionFor(agent.session)).toEqual({ connectorIds: [] })
  })

  it('guards an Agent whose tool registry the controller context cannot see without restricting it', async () => {
    const { agents } = await harness(false)
    const { ctx } = await harness()
    ctx.tools.register(connectorTool('mcp__console__ping'))
    const agent = agentUnder(ctx, 'mcp-foreign-tools')
    agents.installMcpSelection(agent, { connectorIds: [] })
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('mcp__console__ping')
    const call = { signal: testToolSignal, callId: ToolCallId('ping'), name: 'mcp__console__ping', arguments: {}, agent }
    expect((await ctx.tools.execute(call)).isError).toBe(true)
  })

  it('updates restrictions and restores unrestricted access while preserving local tools', async () => {
    const { ctx, agents } = await harness()
    for (const name of ['mcp__console__ping', 'local', 'mcp____invalid']) ctx.tools.register(connectorTool(name))
    const agent = agentUnder(ctx, 'mcp-update')
    agents.installMcpSelection(agent, { connectorIds: [] })
    const execute = (name: string) => ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId(name), name, arguments: {}, agent })
    expect((await execute('local')).isError).toBe(false)
    expect((await execute('mcp____invalid')).isError).toBe(false)
    expect((await execute('mcp__console__ping')).isError).toBe(true)
    agents.installMcpSelection(agent, null)
    expect((await execute('mcp__console__ping')).isError).toBe(false)
    agents.installMcpSelection(agent, { connectorIds: ['console'] })
    expect((await execute('mcp__console__ping')).isError).toBe(false)
  })

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
