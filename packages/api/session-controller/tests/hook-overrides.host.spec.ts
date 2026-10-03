import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { HookInventoryReport } from '@deepseek-ai/dsh-hook-protocol'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, expect, it, vi } from 'vitest'
import { createSessionTestController } from './test-remote.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

function agentUnder(ctx: Context, id: string): Agent {
  const session = ctx.sessions.create(SessionId(id), {
    meta: { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1, isSeeded: false, cwd: '/workspace' },
  })
  const reject = (): never => { throw new Error('this fixture does not mutate the inbox') }
  const agent: Agent = {
    id: SessionId(id), session, options: {}, ctx, status: 'idle',
    inbox: { nextTurn: [], nextStep: [], append: reject, prepend: reject, replace: reject, remove: reject, splice: reject, clear: reject },
    steer: vi.fn(), followup: vi.fn(), cancel: vi.fn(), send: vi.fn(), inject: vi.fn(),
    whenIdle: () => Promise.resolve(), runMaintenance: task => task(new AbortController().signal),
  }
  Object.assign(agent, { ctx: createScope(ctx, agent).ctx })
  return agent
}

it('lists loaded bridge hooks and records per-Session overrides in the projection', async () => {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const reports: HookInventoryReport[] = [
    { dialect: 'codex', source: '/hooks.json', status: 'loaded', skipped: [], settingsNs: 'hooks-codex', handlers: [
      { event: 'PreToolUse', matcher: 'Bash', command: 'guard', key: 'k1', disabled: true, description: 'Blocks risky tools' },
      { event: 'Stop', command: 'notify', key: 'k2' },
    ] },
    { dialect: 'claude-code', source: '/settings.json', status: 'configured', skipped: [], handlers: [
      { event: 'Stop', command: 'external', key: 'k3' },
    ] },
  ]
  ctx.on('hooks/inventory', (target) => { target.push(...reports) })
  const controller = createSessionTestController(ctx, {
    defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }), cwd: '/workspace',
  })
  expect(controller.listHooks()).toEqual({ hooks: [
    { key: 'k1', dialect: 'codex', event: 'PreToolUse', matcher: 'Bash', command: 'guard', globallyDisabled: true, description: 'Blocks risky tools' },
    { key: 'k2', dialect: 'codex', event: 'Stop', command: 'notify', globallyDisabled: false },
  ] })
  const agent = agentUnder(ctx, 'hook-overrides')
  await ctx.agents.register(agent)
  expect(ctx.sessionProjections.stateOf(agent.session, 'hookOverrides')).toEqual({ current: null })
  agent.session.append('mcp/selection', { connectorIds: [] })
  expect(ctx.sessionProjections.stateOf(agent.session, 'hookOverrides')).toEqual({ current: null })
  await expect(controller.setHookOverrides({ sessionId: agent.id, overrides: { k1: true, k2: false } }))
    .resolves.toEqual({ overrides: { k1: true, k2: false } })
  expect(ctx.sessionProjections.stateOf(agent.session, 'hookOverrides')).toEqual({ current: { overrides: { k1: true, k2: false } } })
})
