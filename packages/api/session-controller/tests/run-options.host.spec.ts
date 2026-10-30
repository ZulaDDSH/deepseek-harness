import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { modelSelectionProjectionDefinition } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, expect, it, vi } from 'vitest'
import { unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createSessionTestController } from './test-remote.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

function agentUnder(ctx: Context, id: string): Agent {
  const meta: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1, isSeeded: false, cwd: '/workspace' }
  const session = ctx.sessions.create(SessionId(id), { meta })
  const reject = (): never => { throw new Error('this fixture does not mutate the inbox') }
  const agent: Agent = {
    id: SessionId(id), session, model: unsupportedModel(), options: {}, ctx, status: 'idle',
    inbox: { nextTurn: [], nextStep: [], append: reject, prepend: reject, replace: reject, remove: reject, splice: reject, clear: reject },
    steer: vi.fn(), followup: vi.fn(), cancel: vi.fn(), send: vi.fn(), inject: vi.fn(),
    whenIdle: () => Promise.resolve(), runMaintenance: task => task(new AbortController().signal),
  }
  Object.assign(agent, { ctx: createScope(ctx, agent).ctx })
  return agent
}

async function runOptionsRoot() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  const controller = await createSessionTestController(ctx, {
    defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }), cwd: '/workspace',
  })
  await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
  return { ctx, controller }
}

it('records run options for every Session without a Claude Code provider', async () => {
  const { ctx, controller } = await runOptionsRoot()
  const agent = agentUnder(ctx, 'run-options')
  await ctx.agents.register(agent)
  expect(ctx.sessionProjections.snapshot(agent.session, ['runOptions']).values.runOptions).toEqual({ current: null })
  await expect(controller.setRunOptions({ sessionId: agent.id, fastMode: true, ultracode: false, effort: 'max' }))
    .resolves.toEqual({ fastMode: true, ultracode: false, effort: 'max' })
  expect(ctx.sessionProjections.snapshot(agent.session, ['runOptions']).values.runOptions)
    .toEqual({ current: { fastMode: true, ultracode: false, effort: 'max' } })
  expect(ctx.sessionProjections.snapshot(agent.session, ['claudeCodeRunOptions']).values.claudeCodeRunOptions).toBeUndefined()
  await expect(controller.setRunOptions({ sessionId: agent.id, effort: 'banana' } as never)).rejects.toMatchObject({ code: 'gateway/bad-request' })
  await expect(controller.setRunOptions({ sessionId: agent.id, fastMode: 'yes' } as never)).rejects.toMatchObject({ code: 'gateway/bad-request' })
})

function ultracodeTextOf(ctx: Context, agent: Agent): Promise<string | undefined> {
  return ctx.systemPrompt.assemble({ agent, scope: agent })
    .then(assembly => assembly.sections.find(section => section.name === 'session:ultracode')?.text)
}

it('adds the Ultracode instruction to the system prompt only for a Session that turns Ultracode on', async () => {
  const { ctx, controller } = await runOptionsRoot()
  const on = agentUnder(ctx, 'ultracode-on')
  const off = agentUnder(ctx, 'ultracode-off')
  await ctx.agents.register(on)
  await ctx.agents.register(off)
  on.session.append('model/selection', { provider: 'anthropic', model: 'claude-opus-5-5' })
  await controller.setRunOptions({ sessionId: on.id, ultracode: true })
  await controller.setRunOptions({ sessionId: off.id, ultracode: false })
  expect(await ultracodeTextOf(ctx, on)).toContain('multi-agent workflows')
  expect(await ultracodeTextOf(ctx, off)).toBe('')
})

it('refuses Ultracode on a model without it and keeps a stored flag there inert', async () => {
  const { ctx, controller } = await runOptionsRoot()
  const agent = agentUnder(ctx, 'ultracode-incapable')
  await ctx.agents.register(agent)
  await expect(controller.setRunOptions({ sessionId: agent.id, ultracode: true }))
    .rejects.toMatchObject({ code: 'gateway/bad-request' })
  await expect(controller.setRunOptions({ sessionId: agent.id, ultracode: true }))
    .rejects.toThrow('"fixture-model"')
  expect(ctx.sessionProjections.snapshot(agent.session, ['runOptions']).values.runOptions).toEqual({ current: null })
  agent.session.append('session/run-options', { ultracode: true })
  expect(await ultracodeTextOf(ctx, agent)).toBe('')
  await expect(controller.setRunOptions({ sessionId: agent.id, fastMode: true, ultracode: true }))
    .resolves.toEqual({ fastMode: true, ultracode: true })
  await expect(controller.setRunOptions({ sessionId: agent.id, ultracode: false }))
    .resolves.toEqual({ ultracode: false })
})

it('carries the Ultracode instruction through a complete persona that keeps no harness section', async () => {
  const { ctx, controller } = await runOptionsRoot()
  const on = agentUnder(ctx, 'ultracode-complete-on')
  const off = agentUnder(ctx, 'ultracode-complete-off')
  await ctx.agents.register(on)
  await ctx.agents.register(off)
  on.session.append('model/selection', { provider: 'anthropic', model: 'claude-opus-5-5' })
  await controller.setRunOptions({ sessionId: on.id, ultracode: true })
  await controller.setRunOptions({ sessionId: off.id, ultracode: false })
  ctx.systemPrompt.section({
    name: 'test:complete-persona',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: 'You are a focused software engineer assistant.{{ultracode_policy}}',
    complete: true,
  })
  const rendered = async (agent: Agent) => {
    const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
    return { sections: assembly.sections.map(section => section.name), text: renderPrompt(assembly) }
  }
  const onPrompt = await rendered(on)
  expect(onPrompt.sections).toEqual(['test:complete-persona'])
  expect(onPrompt.text).toContain('multi-agent workflows')
  expect(await rendered(off)).toEqual({
    sections: ['test:complete-persona'],
    text: 'You are a focused software engineer assistant.',
  })
})
