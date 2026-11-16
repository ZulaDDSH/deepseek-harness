import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { modelSelectionProjectionDefinition } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVolatile } from '../../../../vendor/cosmokit/src/volatile.ts'
import { effectiveSubagentSetupOf, runOptionsValue } from '../src/run-options.ts'
import { orchestratorSelectionOf } from '../src/setup-resolver.ts'
import {
  GSD_CHECK_ROUNDS_MAX, GSD_GATES, GSD_PLAN_AUTHORS, GSD_PLANNING_MODES,
  subagentPolicyText, subagentSetupSchema, subagentWorkflowText, type SubagentSetup,
} from '../src/subagent-setup.ts'
import { unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createSessionTestController } from './test-remote.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

const setup: SubagentSetup = {
  enabled: true,
  reviewRounds: 2,
  roles: {
    coder: { mode: 'fixed', route: { backend: 'llm', provider: 'fixture', model: 'fixture-coder' } },
    reviewer: { mode: 'jev' },
  },
}

function agentUnder(ctx: Context, id: string, lineage: Partial<SessionHeader> = {}): Agent {
  const meta: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1, isSeeded: false, cwd: '/workspace', ...lineage }
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

async function setupRoot(withSubagentTool: boolean, globalSetup?: unknown) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  if (withSubagentTool) {
    ctx.tools.register(defineContentToolFixture({
      name: 'subagent',
      description: 'subagent',
      parameters: {},
      async execute() { return [{ type: 'text', text: 'ok' }] },
    }))
  }
  const controller = await createSessionTestController(ctx, {
    defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }), cwd: '/workspace',
    ...globalSetup === undefined ? {} : { subagentSetup: createVolatile(globalSetup) },
  })
  await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
  return { ctx, controller }
}

async function policyText(ctx: Context, agent: Agent): Promise<string | undefined> {
  return (await ctx.systemPrompt.assemble({ agent, scope: agent }))
    .sections.find(section => section.name === 'session:subagent-policy')?.text
}

async function gsdText(ctx: Context, agent: Agent): Promise<string | undefined> {
  return (await ctx.systemPrompt.assemble({ agent, scope: agent }))
    .sections.find(section => section.name === 'session:gsd-workflow')?.text
}

const gsd = { enabled: true, gates: 'every-step', planAuthor: 'orchestrator', planning: 'commit', checkRounds: 2, parallelWaves: true } as const
const workflow: SubagentSetup = { ...setup, gsd }

it('validates a Subagent Setup at the write boundary', () => {
  expect(subagentSetupSchema.parse(setup)).toEqual(setup)
  const malformed = [
    { ...setup, reviewRounds: 6 },
    { ...setup, reviewRounds: 1.5 },
    { ...setup, roles: { boss: { mode: 'jev' } } },
    { ...setup, roles: { coder: { mode: 'fixed', route: { backend: 'claude-cli', model: 'opus', reasoningEffort: 'turbo' } } } },
    { ...setup, roles: { coder: { mode: 'fixed', route: { backend: 'claude-cli', model: '  ' } } } },
    { ...setup, roles: { coder: { mode: 'fixed', route: { backend: 'llm', provider: '', model: 'm' } } } },
    { ...setup, roles: { coder: { mode: 'fixed', route: { provider: 'fixture', model: 'm' } } } },
    { ...setup, extra: true },
  ]
  for (const candidate of malformed) {
    expect(subagentSetupSchema.safeParse(candidate).success).toBe(false)
  }
})

it('rejects a malformed Subagent Setup in a run-options write with a bad-request error', () => {
  expect(() => runOptionsValue({ subagentSetup: { ...setup, reviewRounds: 9 } })).toThrow('subagentSetup is invalid')
  expect(runOptionsValue({ fastMode: true, ultracode: false, effort: 'high', subagentSetup: setup }))
    .toEqual({ fastMode: true, ultracode: false, effort: 'high', subagentSetup: setup })
})

it('stores a Subagent Setup beside ultracode, fast mode, and effort, and a write replaces the whole value', async () => {
  const { ctx, controller } = await setupRoot(true)
  const agent = agentUnder(ctx, 'setup-round-trip')
  await ctx.agents.register(agent)
  agent.session.append('model/selection', { provider: 'anthropic', model: 'claude-opus-5-5' })
  await expect(controller.setRunOptions({ sessionId: agent.id, fastMode: true, ultracode: true, effort: 'max', subagentSetup: setup }))
    .resolves.toEqual({ fastMode: true, ultracode: true, effort: 'max', subagentSetup: setup })
  expect(ctx.sessionProjections.snapshot(agent.session, ['runOptions']).values.runOptions).toEqual({
    current: { fastMode: true, ultracode: true, effort: 'max', subagentSetup: setup },
  })
  await controller.setRunOptions({ sessionId: agent.id, subagentSetup: setup })
  expect(ctx.sessionProjections.snapshot(agent.session, ['runOptions']).values.runOptions).toEqual({ current: { subagentSetup: setup } })
})

it('adds the subagent policy only while Subagent Setup is on and the subagent tool is in scope', async () => {
  const { ctx, controller } = await setupRoot(true)
  const on = agentUnder(ctx, 'policy-on')
  const off = agentUnder(ctx, 'policy-off')
  const none = agentUnder(ctx, 'policy-none')
  await ctx.agents.register(on)
  await ctx.agents.register(off)
  await ctx.agents.register(none)
  await controller.setRunOptions({ sessionId: on.id, subagentSetup: setup })
  await controller.setRunOptions({ sessionId: off.id, subagentSetup: { ...setup, enabled: false } })
  expect(await policyText(ctx, on)).toBe(subagentPolicyText(setup))
  expect(await policyText(ctx, off)).toBe('')
  expect(await policyText(ctx, none)).toBe('')

  const bare = await setupRoot(false)
  const bareAgent = agentUnder(bare.ctx, 'policy-no-tool')
  await bare.ctx.agents.register(bareAgent)
  await bare.controller.setRunOptions({ sessionId: bareAgent.id, subagentSetup: setup })
  expect(await policyText(bare.ctx, bareAgent)).toBe('')
})

it('carries the subagent policy into a complete persona through the subagent_policy variable', async () => {
  const { ctx, controller } = await setupRoot(true)
  const on = agentUnder(ctx, 'policy-complete')
  await ctx.agents.register(on)
  await controller.setRunOptions({ sessionId: on.id, subagentSetup: setup })
  ctx.systemPrompt.section({
    name: 'test:complete-persona',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: 'You are a focused software engineer assistant.{{subagent_policy}}',
    complete: true,
  })
  const assembly = await ctx.systemPrompt.assemble({ agent: on, scope: on })
  expect(renderPrompt(assembly)).toContain('Subagent mode is on for this session.')
})

it('renders the subagent policy once in the system prompt beside a default (non-complete) persona', async () => {
  const { ctx, controller } = await setupRoot(true)
  const on = agentUnder(ctx, 'policy-default-persona')
  await ctx.agents.register(on)
  await controller.setRunOptions({ sessionId: on.id, subagentSetup: setup })
  ctx.systemPrompt.section({
    name: 'test:default-persona',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: 'You are a coding agent powered by the fixture model.',
  })
  const rendered = renderPrompt(await ctx.systemPrompt.assemble({ agent: on, scope: on }))
  expect(rendered).toContain('You are a coding agent powered by the fixture model.')
  expect(rendered.split(subagentPolicyText(setup))).toHaveLength(2)
})

it('withholds the policy from a child Session that inherits the setup, since only the top-level orchestrator runs it', async () => {
  const { ctx, controller } = await setupRoot(true)
  const parent = agentUnder(ctx, 'policy-parent')
  await ctx.agents.register(parent)
  await controller.setRunOptions({ sessionId: parent.id, subagentSetup: setup })
  expect(await policyText(ctx, parent)).toBe(subagentPolicyText(setup))
  const child = agentUnder(ctx, 'policy-child', { origin: 'subagent', parentSession: parent.id })
  await ctx.agents.register(child)
  expect(await policyText(ctx, child)).toBe('')
})

it('describes only configured roles and the review rounds', () => {
  const text = subagentPolicyText(setup)
  expect(subagentPolicyText({ ...setup, enabled: false })).toBe('')
  expect(text).toContain('pass role as one of: coder (implementation), reviewer (independent review).')
  expect(text).not.toContain('researcher')
  expect(text).toContain('for at most 2 review rounds before you report.')
  expect(subagentPolicyText({ ...setup, reviewRounds: 1, roles: {} })).toContain('cannot run a role')
  expect(subagentPolicyText({ ...setup, reviewRounds: 1 })).toContain('for at most 1 review round before you report.')
  expect(subagentPolicyText({ ...setup, reviewRounds: 0 })).toContain('Do not run review rounds')
  expect(subagentPolicyText({ ...setup, reviewRounds: 3, roles: { coder: { mode: 'jev' } } })).not.toContain('review round')
})

it('tells the orchestrator to plan, delegate, parallelize and not implement itself', () => {
  const full = subagentPolicyText({
    ...setup,
    roles: { coder: { mode: 'jev' }, reviewer: { mode: 'jev' }, researcher: { mode: 'jev' } },
  })
  expect(full).toContain('You are the orchestrator: plan the work, brief each subagent completely, and verify what comes back.')
  expect(full).toContain('Delegate implementation to a coder and do not make code changes yourself; writing brief and handoff files is fine.')
  expect(full).toContain('Delegate research and log reading to a researcher.')
  expect(full).toContain('Run independent work in parallel.')
  expect(full).toContain('Every subagent call must pass role')
  expect(full).toContain('Subagents cannot start subagents, so you start every subagent yourself.')
  expect(full).toContain('After a coder returns a code change, start a reviewer (role reviewer) on it, send its findings to the coder with send_message')
  expect(full).toContain('repeat for at most 2 review rounds before you report.')
  const noCoder = subagentPolicyText({ ...setup, roles: { reviewer: { mode: 'jev' } } })
  expect(noCoder).not.toContain('do not make code changes yourself')
  expect(noCoder).not.toContain('researcher')
})

it('defaults the GSD settings through the strict schema and rejects malformed ones', () => {
  expect(subagentSetupSchema.parse({ ...setup, gsd: { enabled: true } }).gsd).toEqual({
    enabled: true, gates: 'every-step', planAuthor: 'orchestrator', planning: 'commit', checkRounds: 2, parallelWaves: true,
  })
  expect(subagentSetupSchema.parse({ ...setup, gsd: { enabled: false, gates: 'auto' } }).gsd?.enabled).toBe(false)
  expect(subagentSetupSchema.parse(setup).gsd).toBeUndefined()
  const malformed = [
    { ...setup, gsd: { enabled: true, gates: 'sometimes' } },
    { ...setup, gsd: { enabled: true, planAuthor: 'coder' } },
    { ...setup, gsd: { enabled: true, planning: 'ignore' } },
    { ...setup, gsd: { enabled: true, checkRounds: 6 } },
    { ...setup, gsd: { enabled: true, checkRounds: 1.5 } },
    { ...setup, gsd: { enabled: true, parallelWaves: 'yes' } },
    { ...setup, gsd: { enabled: true, extra: 1 } },
    { ...setup, gsd: { gates: 'auto' } },
  ]
  for (const candidate of malformed) {
    expect(subagentSetupSchema.safeParse(candidate).success).toBe(false)
  }
  expect(() => runOptionsValue({ subagentSetup: { ...setup, gsd: { ...gsd, checkRounds: 9 } } }))
    .toThrow('subagentSetup is invalid')
})

it('states each chosen GSD setting in the workflow text, and is empty when the workflow or subagent mode is off', () => {
  const text = subagentWorkflowText(workflow)
  expect(text).toContain('Gates: every-step.')
  expect(text).toContain('Plan author: orchestrator. You write the plan files yourself.')
  expect(text).toContain('Planning files: commit .planning/ to the repo')
  expect(text).toContain('<NN>-<PP>-PLAN.md')
  expect(text).toContain('Check rounds: 2.')
  expect(text).toContain('for at most 2 rounds')
  expect(text).toContain('run the plans of one wave in parallel')
  const custom = subagentWorkflowText({ ...setup, gsd: { enabled: true, gates: 'auto', planAuthor: 'researcher', planning: 'local', checkRounds: 1, parallelWaves: false } })
  expect(custom).toContain('Gates: auto. Run each step without asking.')
  expect(custom).toContain('Plan author: researcher. The researcher writes the plan files')
  expect(custom).toContain('Planning files: keep .planning/ local. Add it to .git/info/exclude')
  expect(custom).toContain('run the plans one at a time, in order.')
  expect(custom).toContain('for at most 1 round;')
  expect(custom).toContain('Ship creates the PR and never merges.')
  expect(custom).toContain('still stops to ask on a failure, a blocked verification, and any push, PR or merge.')
  expect(subagentWorkflowText(checkless(workflow, 0))).toContain('Check rounds: 0. Run each plan check and verification once with no fix rounds')
  expect(subagentWorkflowText({ ...workflow, enabled: false })).toBe('')
  expect(subagentWorkflowText({ ...workflow, gsd: { ...gsd, enabled: false } })).toBe('')
  expect(subagentWorkflowText(setup)).toBe('')
})

function checkless(base: SubagentSetup, checkRounds: number): SubagentSetup {
  return { ...base, gsd: { ...gsd, checkRounds } }
}

it('adds the GSD section only to the top-level orchestrator while subagent mode and the workflow are on', async () => {
  const { ctx, controller } = await setupRoot(true)
  const on = agentUnder(ctx, 'gsd-on')
  const child = agentUnder(ctx, 'gsd-child', { origin: 'subagent', parentSession: on.id })
  const off = agentUnder(ctx, 'gsd-subagent-off')
  const workflowOff = agentUnder(ctx, 'gsd-workflow-off')
  await ctx.agents.register(on)
  await ctx.agents.register(child)
  await ctx.agents.register(off)
  await ctx.agents.register(workflowOff)
  await controller.setRunOptions({ sessionId: on.id, subagentSetup: workflow })
  await controller.setRunOptions({ sessionId: off.id, subagentSetup: { ...workflow, enabled: false } })
  await controller.setRunOptions({ sessionId: workflowOff.id, subagentSetup: { ...setup, gsd: { ...gsd, enabled: false } } })
  expect(await gsdText(ctx, on)).toBe(subagentWorkflowText(workflow))
  expect(await gsdText(ctx, child)).toBe('')
  expect(await gsdText(ctx, off)).toBe('')
  expect(await gsdText(ctx, workflowOff)).toBe('')
})

it('resolves one setup per Session: its override, else the nearest ancestor, else the global default, else nothing', async () => {
  const globalSetup: SubagentSetup = { enabled: true, reviewRounds: 1, roles: { reviewer: { mode: 'jev' } } }
  const { ctx, controller } = await setupRoot(true, globalSetup)
  const own = agentUnder(ctx, 'resolve-own')
  const parent = agentUnder(ctx, 'resolve-parent')
  const child = agentUnder(ctx, 'resolve-child', { origin: 'subagent', parentSession: parent.id })
  const bare = agentUnder(ctx, 'resolve-bare')
  for (const agent of [own, parent, child, bare]) await ctx.agents.register(agent)
  await controller.setRunOptions({ sessionId: own.id, subagentSetup: setup })
  await controller.setRunOptions({ sessionId: parent.id, subagentSetup: workflow })
  expect(effectiveSubagentSetupOf(ctx, own.session)).toEqual(setup)
  expect(effectiveSubagentSetupOf(ctx, child.session)).toEqual(workflow)
  expect(effectiveSubagentSetupOf(ctx, bare.session)).toEqual(globalSetup)
  const none = await setupRoot(true)
  const lone = agentUnder(none.ctx, 'resolve-none')
  await none.ctx.agents.register(lone)
  expect(effectiveSubagentSetupOf(none.ctx, lone.session)).toBeUndefined()
})

it('uses the global default in the policy and GSD sections for a Session with no override, and an override wins over it', async () => {
  const { ctx, controller } = await setupRoot(true, workflow)
  const bare = agentUnder(ctx, 'global-bare')
  await ctx.agents.register(bare)
  expect(await policyText(ctx, bare)).toBe(subagentPolicyText(workflow))
  expect(await gsdText(ctx, bare)).toBe(subagentWorkflowText(workflow))
  await controller.setRunOptions({ sessionId: bare.id, subagentSetup: { ...setup, enabled: false } })
  expect(await policyText(ctx, bare)).toBe('')
  expect(await gsdText(ctx, bare)).toBe('')
})

it('ignores a stored global default that fails the strict schema', async () => {
  const { controller } = await setupRoot(false, workflow)
  expect(controller.defaultSubagentSetup()).toEqual(workflow)
  const malformed = await setupRoot(false, { ...setup, reviewRounds: 9 })
  expect(malformed.controller.defaultSubagentSetup()).toBeUndefined()
  const badGsd = await setupRoot(false, { ...setup, gsd: { enabled: true, gates: 'sometimes' } })
  expect(badGsd.controller.defaultSubagentSetup()).toBeUndefined()
})

it('adds the GSD section only while the subagent tool is in scope', async () => {
  const withTool = await setupRoot(true, workflow)
  const withoutTool = await setupRoot(false, workflow)
  const a = agentUnder(withTool.ctx, 'gsd-tool')
  const b = agentUnder(withoutTool.ctx, 'gsd-no-tool')
  await withTool.ctx.agents.register(a)
  await withoutTool.ctx.agents.register(b)
  expect(await gsdText(withTool.ctx, a)).toBe(subagentWorkflowText(workflow))
  expect(await gsdText(withoutTool.ctx, b)).toBe('')
})

it('warns once, not on every read, when the stored global default is invalid', async () => {
  const { ctx, controller } = await setupRoot(false, { ...setup, reviewRounds: 9 })
  const warn = vi.spyOn(ctx.logger, 'warn')
  expect(controller.defaultSubagentSetup()).toBeUndefined()
  expect(controller.defaultSubagentSetup()).toBeUndefined()
  expect(warn).toHaveBeenCalledTimes(1)
})

it('carries the GSD workflow into a complete persona through the gsd_workflow variable', async () => {
  const { ctx, controller } = await setupRoot(true)
  const complete = agentUnder(ctx, 'gsd-complete')
  await ctx.agents.register(complete)
  await controller.setRunOptions({ sessionId: complete.id, subagentSetup: workflow })
  ctx.systemPrompt.section({
    name: 'test:complete-persona',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: 'You are a focused software engineer assistant.{{gsd_workflow}}',
    complete: true,
  })
  expect(renderPrompt(await ctx.systemPrompt.assemble({ agent: complete, scope: complete }))).toContain(subagentWorkflowText(workflow))
})

it('uses the vocabulary and defaults of the skill-gsd settings file', async () => {
  const settings = await readFile(new URL('../../../skill/skill-gsd/assets/shared/settings.md', import.meta.url), 'utf8')
  const row = (name: string): string[] => settings.split('\n').find(line => line.startsWith(`| \`${name}\` |`))!.split('|').map(cell => cell.trim())
  const defaults = subagentSetupSchema.parse({ ...setup, gsd: { enabled: true } }).gsd!
  for (const [name, values, fallback] of [
    ['gates', GSD_GATES, defaults.gates],
    ['planAuthor', GSD_PLAN_AUTHORS, defaults.planAuthor],
    ['planning', GSD_PLANNING_MODES, defaults.planning],
  ] as const) {
    for (const value of values) expect(row(name)[2], name).toContain(`\`${value}\``)
    expect(row(name)[3], name).toBe(`\`${fallback}\``)
  }
  expect(row('checkRounds')[2]).toBe(`\`0\` to \`${GSD_CHECK_ROUNDS_MAX}\``)
  expect(row('checkRounds')[3]).toBe(`\`${defaults.checkRounds}\``)
  expect(row('parallelWaves')[3]).toBe(`\`${defaults.parallelWaves}\``)
  for (const gates of GSD_GATES) expect(subagentWorkflowText({ ...setup, gsd: { ...gsd, gates } })).toContain(`Gates: ${gates}.`)
  expect(subagentWorkflowText(workflow).length).toBeLessThanOrEqual(1800)
})

describe('orchestrator route that drives a Session model', () => {
  const drivenRoute = { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' }
  const fixedLlm: SubagentSetup = {
    enabled: true,
    reviewRounds: 0,
    roles: { orchestrator: { mode: 'fixed', route: { backend: 'llm', provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' } } },
  }

  it('applies the global default only while it is on and fixes the orchestrator to an LLM route', async () => {
    const on = await setupRoot(false, fixedLlm)
    const bare = agentUnder(on.ctx, 'orchestrated-bare')
    await on.ctx.agents.register(bare)
    expect(orchestratorSelectionOf(on.ctx, bare.session)).toEqual(drivenRoute)
    for (const globalSetup of [
      { ...fixedLlm, enabled: false },
      { ...fixedLlm, roles: { orchestrator: { mode: 'jev' as const } } },
      { ...fixedLlm, roles: { orchestrator: { mode: 'fixed' as const, route: { backend: 'claude-cli' as const, model: 'opus' } } } },
    ]) {
      const off = await setupRoot(false, globalSetup)
      const session = agentUnder(off.ctx, 'orchestrated-off')
      await off.ctx.agents.register(session)
      expect(orchestratorSelectionOf(off.ctx, session.session)).toBeUndefined()
    }
    const none = await setupRoot(false)
    const lone = agentUnder(none.ctx, 'orchestrated-none')
    await none.ctx.agents.register(lone)
    expect(orchestratorSelectionOf(none.ctx, lone.session)).toBeUndefined()
  })

  it('lets a Session override decide, in both directions, over the global default', async () => {
    const { ctx, controller } = await setupRoot(false, { ...fixedLlm, enabled: false })
    const own = agentUnder(ctx, 'orchestrated-own')
    await ctx.agents.register(own)
    expect(orchestratorSelectionOf(ctx, own.session)).toBeUndefined()
    await controller.setRunOptions({ sessionId: own.id, subagentSetup: fixedLlm })
    expect(orchestratorSelectionOf(ctx, own.session)).toEqual(drivenRoute)

    const onGlobal = await setupRoot(false, fixedLlm)
    const off = agentUnder(onGlobal.ctx, 'orchestrated-own-off')
    await onGlobal.ctx.agents.register(off)
    await onGlobal.controller.setRunOptions({ sessionId: off.id, subagentSetup: { ...fixedLlm, enabled: false } })
    expect(orchestratorSelectionOf(onGlobal.ctx, off.session)).toBeUndefined()
  })

  it('never applies to a subagent child, and does not carry a parent override to its fork', async () => {
    const { ctx, controller } = await setupRoot(false, { ...fixedLlm, enabled: false })
    const parent = agentUnder(ctx, 'orchestrated-parent')
    await ctx.agents.register(parent)
    await controller.setRunOptions({ sessionId: parent.id, subagentSetup: fixedLlm })
    expect(orchestratorSelectionOf(ctx, parent.session)).toEqual(drivenRoute)
    const child = agentUnder(ctx, 'orchestrated-child', { origin: 'subagent', parentSession: parent.id })
    await ctx.agents.register(child)
    expect(orchestratorSelectionOf(ctx, child.session)).toBeUndefined()
    const fork = agentUnder(ctx, 'orchestrated-fork', { parentSession: parent.id })
    await ctx.agents.register(fork)
    expect(orchestratorSelectionOf(ctx, fork.session)).toBeUndefined()
    const onGlobal = await setupRoot(false, fixedLlm)
    const inherits = agentUnder(onGlobal.ctx, 'orchestrated-fork-global', { parentSession: parent.id })
    await onGlobal.ctx.agents.register(inherits)
    expect(orchestratorSelectionOf(onGlobal.ctx, inherits.session)).toEqual(drivenRoute)
  })
})
