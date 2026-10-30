import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionRunOptions } from '@deepseek-ai/dsh-api-session-controller'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as mock from './scripted-provider.ts'
import { callSubagent, fakeAgent, setup, text } from './harness.ts'

type SubagentSetup = NonNullable<SessionRunOptions['subagentSetup']>

const REASONING = {
  efforts: [
    { id: ReasoningEffortId('low'), name: 'Low' },
    { id: ReasoningEffortId('high'), name: 'High' },
  ],
  defaultEffort: ReasoningEffortId('high'),
} as const

let parentCount = 0

async function parentWithSetup(ctx: Context, subagentSetup: SubagentSetup | undefined): Promise<Agent> {
  const readOriginal = SessionProjectionRegistry.prototype.snapshot.bind(ctx.sessionProjections)
  vi.spyOn(ctx.sessionProjections, 'snapshot').mockImplementation((session, keys) => {
    const snapshot = readOriginal(session, keys)
    return [...keys ?? []].includes('runOptions')
      ? { ...snapshot, values: { ...snapshot.values, runOptions: { current: { subagentSetup } } } }
      : snapshot
  })
  parentCount += 1
  return liveAgent(ctx, `role-parent-${parentCount}`)
}

async function liveAgent(ctx: Context, id: string): Promise<Agent> {
  const scopeFiber = ctx.plugin(() => {})
  const parent = { ...fakeAgent(id), ctx: scopeFiber.ctx } as Agent
  await ctx.agents.register(parent)
  return parent
}

function roleCall(ctx: Context, parent: Agent, args: Record<string, unknown>) {
  return callSubagent(ctx, { description: 'delegated task', prompt: 'do it', ...args }, { agent: parent })
}

const ENABLED = { enabled: true, reviewRounds: 0 } as const

describe('dsh-tool-subagent roles', () => {
  it('runs a fixed llm role on its route and pins the child', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    const parent = await parentWithSetup(ctx, {
      ...ENABLED,
      roles: { coder: { mode: 'fixed', route: { backend: 'llm', provider: 'alpha', model: 'coder-model', reasoningEffort: 'low' } } },
    })

    const result = await roleCall(ctx, parent, { role: 'coder' })

    expect(result.isError).toBe(false)
    expect(starts[0]?.agentOptions).toEqual({
      provider: 'alpha',
      model: 'coder-model',
      reasoningEffort: ReasoningEffortId('low'),
    })
    expect(starts[0]?.routePinned).toBe(true)
  })

  it('fails a role whose route cannot be resolved before any child starts, naming the role and route', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    const parent = await parentWithSetup(ctx,{
      ...ENABLED,
      roles: { coder: { mode: 'fixed', route: { backend: 'llm', provider: 'ghost', model: 'coder-model' } } },
    })

    const result = await roleCall(ctx, parent, { role: 'coder' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('subagent role "coder" is set to ghost/coder-model, which cannot run: no adapter registered for provider "ghost"')
    expect(text(result)).toContain('pick another route in Orchestrator & Subagent Setup')
    expect(starts).toHaveLength(0)
  })

  it('fails a role whose provider has no configured credential before any child starts, naming role, provider, model and fix', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    ctx.llm.registerAdapter(['beta'], new MockAdapter([], REASONING))
    ctx.provide('sessionController', { defaultSubagentSetup: () => undefined, missingCredentialProviders: async () => ['alpha'] } as never)
    const parent = await parentWithSetup(ctx,{
      ...ENABLED,
      roles: { coder: { mode: 'fixed', route: { backend: 'llm', provider: 'alpha', model: 'coder-model' } } },
    })

    const result = await roleCall(ctx, parent, { role: 'coder' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('subagent role "coder" is set to alpha/coder-model, which cannot run: no credential is configured for provider "alpha"; pick another route in Orchestrator & Subagent Setup or add a key in Settings')
    expect(starts).toHaveLength(0)

    const funded = await parentWithSetup(ctx,{
      ...ENABLED,
      roles: { coder: { mode: 'fixed', route: { backend: 'llm', provider: 'beta', model: 'coder-model' } } },
    })
    const ok = await roleCall(ctx, funded, { role: 'coder' })
    expect(ok.isError).toBe(false)
    expect(starts).toHaveLength(1)
  })

  it('leaves a Jev-decides role unrouted and unpinned', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    const parent = await parentWithSetup(ctx,{ ...ENABLED, roles: { coder: { mode: 'jev' } } })

    const result = await roleCall(ctx, parent, { role: 'coder' })

    expect(result.isError).toBe(false)
    expect(starts[0]?.agentOptions).toBeUndefined()
    expect(starts[0]?.routePinned).toBeUndefined()
  })

  it('runs a Claude-subscription role on the Claude provider without a depth cap', async () => {
    const starts: SubagentStartRequest[] = []
    const claudeStarts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    await mock.mountScriptedProvider(ctx, {
      name: 'claude-code',
      capabilities: { depthLimit: false },
      onStart: (request) => { claudeStarts.push(request) },
    })
    const parent = await parentWithSetup(ctx,{
      ...ENABLED,
      roles: { coder: { mode: 'fixed', route: { backend: 'claude-cli', model: 'cli-model', reasoningEffort: 'high' } } },
    })

    const result = await roleCall(ctx, parent, { role: 'coder' })

    expect(result.isError).toBe(false)
    expect(starts).toHaveLength(0)
    expect(claudeStarts[0]?.agentOptions).toEqual({ model: 'cli-model', reasoningEffort: ReasoningEffortId('high') })
    expect(claudeStarts[0]?.routePinned).toBe(true)
    expect(claudeStarts[0]?.maxDepth).toBeUndefined()
  })

  it('rejects a role when Orchestrator & Subagent Setup is off', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    const parent = await parentWithSetup(ctx,{ enabled: false, reviewRounds: 0, roles: {} })

    const result = await roleCall(ctx, parent, { role: 'coder' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('needs Orchestrator & Subagent Setup, which is off')
    expect(starts).toHaveLength(0)
  })

  it('rejects a role the setup does not configure', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    const parent = await parentWithSetup(ctx,{ ...ENABLED, roles: { coder: { mode: 'jev' } } })

    const result = await roleCall(ctx, parent, { role: 'reviewer' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('subagent role "reviewer" has no model in Orchestrator & Subagent Setup; configured roles: coder')
    expect(starts).toHaveLength(0)
  })

  it('rejects a role combined with an explicit route', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    const parent = await parentWithSetup(ctx,{ ...ENABLED, roles: { coder: { mode: 'jev' } } })

    const result = await roleCall(ctx, parent, { role: 'coder', provider: 'alpha', model: 'other-model' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('omit provider, model, and reasoning_effort')
    expect(text(result)).toContain('configured roles: coder')
    expect(starts).toHaveLength(0)
  })

  it('rejects an explicit route without a role while Orchestrator & Subagent Setup is on', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    const parent = await parentWithSetup(ctx,{ ...ENABLED, roles: { coder: { mode: 'jev' } } })

    for (const route of [{ provider: 'alpha', model: 'other-model' }, { model: 'other-model' }, { reasoning_effort: 'low' }]) {
      const result = await roleCall(ctx, parent, route)
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('must pass role (coder)')
    }
    expect(starts).toHaveLength(0)
  })

  it('rejects a role-less call while Orchestrator & Subagent Setup is on and lists the configured roles', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    const parent = await parentWithSetup(ctx,{
      ...ENABLED,
      roles: { orchestrator: { mode: 'jev' }, coder: { mode: 'jev' }, researcher: { mode: 'jev' } },
    })

    const result = await roleCall(ctx, parent, {})

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('must pass role (coder, researcher)')
    expect(starts).toHaveLength(0)
  })

  it('never lets a role-less call inherit the parent route while a fixed role exists', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    const parent = await parentWithSetup(ctx,{
      ...ENABLED,
      roles: { coder: { mode: 'fixed', route: { backend: 'llm', provider: 'alpha', model: 'coder-model', reasoningEffort: 'high' } } },
    })

    const withoutRole = await roleCall(ctx, parent, {})
    const withOverride = await roleCall(ctx, parent, { role: 'coder', provider: 'anthropic', model: 'claude-opus-5-5' })
    const withRole = await roleCall(ctx, parent, { role: 'coder' })

    expect(withoutRole.isError).toBe(true)
    expect(withOverride.isError).toBe(true)
    expect(withRole.isError).toBe(false)
    expect(starts).toHaveLength(1)
    expect(starts[0]?.agentOptions).toEqual({ provider: 'alpha', model: 'coder-model', reasoningEffort: ReasoningEffortId('high') })
    expect(starts[0]?.routePinned).toBe(true)
  })

  it('keeps a role-less call working when Orchestrator & Subagent Setup configures no delegation role', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    const parent = await parentWithSetup(ctx,{ ...ENABLED, roles: { orchestrator: { mode: 'jev' } } })

    const result = await roleCall(ctx, parent, {})

    expect(result.isError).toBe(false)
    expect(starts[0]?.routePinned).toBeUndefined()
  })

  it('allows an explicit route without a role while Orchestrator & Subagent Setup is off', async () => {
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 })
    const parent = await parentWithSetup(ctx,{ ...ENABLED, enabled: false, roles: {} })

    const result = await roleCall(ctx, parent, { reasoning_effort: 'low' })

    expect(text(result)).not.toContain('pass role')
  })

  it('rejects a role outside the delegation roles', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    const parent = await parentWithSetup(ctx,{ ...ENABLED, roles: { orchestrator: { mode: 'jev' } } })

    const result = await roleCall(ctx, parent, { role: 'orchestrator' })

    expect(result.isError).toBe(true)
    expect(starts).toHaveLength(0)
  })

  it('rejects a Claude-subscription role when the Claude provider is not installed', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    const parent = await parentWithSetup(ctx,{
      ...ENABLED,
      roles: { coder: { mode: 'fixed', route: { backend: 'claude-cli', model: 'cli-model' } } },
    })

    const result = await roleCall(ctx, parent, { role: 'coder' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('is not installed or takes no per-run model')
    expect(starts).toHaveLength(0)
  })

  it('ignores a role argument when the instance does not enable roles', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    const parent = await parentWithSetup(ctx,undefined)

    const result = await roleCall(ctx, parent, { role: 'coder' })

    expect(result.isError).toBe(false)
    expect(starts[0]?.routePinned).toBeUndefined()
  })

  it('rejects a delegation tool without roles while Orchestrator & Subagent Setup governs the session', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    const parent = await parentWithSetup(ctx,{ ...ENABLED, roles: { coder: { mode: 'jev' } } })

    const result = await callSubagent(ctx, { description: 'delegated task', prompt: 'do it' }, { agent: parent })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('so subagent is unavailable; use the subagent tool with role (coder)')
    expect(starts).toHaveLength(0)
  })
})

describe('dsh-tool-subagent roles under the global default setup', () => {
  it('routes a Session without its own override by the global default, and an override wins over it', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', roles: true, maxDepth: 1 }, {
      onStart: (request) => { starts.push(request) },
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    const globalSetup = {
      ...ENABLED,
      roles: { coder: { mode: 'fixed', route: { backend: 'llm', provider: 'alpha', model: 'global-coder', reasoningEffort: 'low' } } },
    } as const
    ctx.provide('sessionController', { defaultSubagentSetup: () => globalSetup, missingCredentialProviders: async () => [] } as never)
    const inheriting = await liveAgent(ctx, 'role-global-inherit')

    const result = await roleCall(ctx, inheriting, { role: 'coder' })

    expect(result.isError).toBe(false)
    expect(starts[0]?.agentOptions).toEqual({ provider: 'alpha', model: 'global-coder', reasoningEffort: ReasoningEffortId('low') })
    expect(starts[0]?.routePinned).toBe(true)

    const overriding = await parentWithSetup(ctx,{ ...ENABLED, roles: { coder: { mode: 'jev' } } })
    const jev = await roleCall(ctx, overriding, { role: 'coder' })
    expect(jev.isError).toBe(false)
    expect(starts[1]?.routePinned).not.toBe(true)
  })
})
