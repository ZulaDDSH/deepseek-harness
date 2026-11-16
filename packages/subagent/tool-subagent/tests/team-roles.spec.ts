import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { callSubagent, modelSelectionSetupAgent, setup, text } from './harness.ts'

const REASONING = {
  efforts: [
    { id: ReasoningEffortId('low'), name: 'Low' },
    { id: ReasoningEffortId('high'), name: 'High' },
  ],
  defaultEffort: ReasoningEffortId('high'),
} as const

describe('dsh-tool-subagent Team roles', () => {
  it('authorizes a saved default and lets explicit selection take precedence', async () => {
    const requests: SubagentStartRequest[] = []
    const ctx = await setup({
      provider: 'mock',
      withModelSelection: true,
      parentAgentOptions: { provider: 'alpha', model: 'parent-model' },
    }, { onStart: request => { requests.push(request) } })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    ctx.set('agentTeams', { isEnabled: () => true } as never)
    ctx.set('sessionController', {
      teamRoleDefaultOf: () => ({ backend: 'llm', provider: 'alpha', model: 'allowed-model', reasoningEffort: 'high' }),
      missingCredentialProvider: async () => false,
    } as never)
    const parent = modelSelectionSetupAgent(ctx)

    const role = await callSubagent(ctx, { description: 'role route', prompt: 'work', role: 'coder' }, { agent: parent })
    const explicit = await callSubagent(ctx, {
      description: 'explicit route', prompt: 'work', role: 'coder', provider: 'alpha', model: 'parent-model',
    }, { agent: parent })

    expect(role.isError, text(role)).toBe(false)
    expect(requests[0]?.agentOptions).toEqual({ provider: 'alpha', model: 'allowed-model', reasoningEffort: 'high' })
    expect(explicit.isError, text(explicit)).toBe(false)
    expect(requests[1]?.agentOptions).toEqual({ provider: 'alpha', model: 'parent-model' })
  })

  it('rejects a saved route without credentials before starting the child', async () => {
    const start = vi.fn()
    const ctx = await setup({ provider: 'mock', withModelSelection: true }, { onStart: start })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    ctx.set('agentTeams', { isEnabled: () => true } as never)
    ctx.set('sessionController', {
      teamRoleDefaultOf: () => ({ backend: 'llm', provider: 'alpha', model: 'allowed-model' }),
      missingCredentialProvider: async () => true,
    } as never)

    const result = await callSubagent(ctx, { description: 'missing key', prompt: 'work', role: 'coder' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no configured credential')
    expect(start).not.toHaveBeenCalled()
  })

  it('does not resolve saved role defaults when Agent Teams is disabled', async () => {
    const start = vi.fn()
    const ctx = await setup({ provider: 'mock' }, { onStart: start })
    const lookup = vi.fn(() => { throw new Error('role lookup should not run') })
    ctx.set('agentTeams', { isEnabled: () => false } as never)
    ctx.set('sessionController', { teamRoleDefaultOf: lookup } as never)

    const result = await callSubagent(ctx, { description: 'ordinary child', prompt: 'work', role: 'coder' })

    expect(result.isError, text(result)).toBe(false)
    expect(lookup).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledOnce()
  })
})
