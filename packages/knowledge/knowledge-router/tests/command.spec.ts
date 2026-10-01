/**
 * The `/knowledge` status command: the report format, and that the command is
 * registered and executable through the real human-command registry.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Commands from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import KnowledgeRouter from '../src/index.ts'
import { describeKnowledge } from '../src/command.ts'
import type { KnowledgeStatusTarget } from '../src/command.ts'
import type { ProviderStatus } from '../src/types.ts'

/** A status report for the given providers. */
function target(mode: 'off' | 'manual' | 'assisted', statuses: ProviderStatus[]): KnowledgeStatusTarget {
  return { mode, status: () => statuses }
}

const connected: ProviderStatus = {
  provider: 'gitnexus',
  enabled: true,
  serverName: 'gitnexus',
  connected: true,
  tools: ['impact', 'query'],
}

const disconnected: ProviderStatus = {
  provider: 'graphify',
  enabled: true,
  serverName: 'graphify',
  connected: false,
  tools: [],
}

const disabled: ProviderStatus = {
  provider: 'graphify',
  enabled: false,
  serverName: '',
  connected: false,
  tools: [],
}

describe('describeKnowledge', () => {
  it('reports the mode and every provider state', () => {
    expect(describeKnowledge(target('assisted', [connected, disconnected]))).toBe([
      'knowledge mode: assisted',
      'gitnexus: connected (server gitnexus) tools: impact, query',
      'graphify: disconnected (server graphify)',
    ].join('\n'))
  })

  it('distinguishes a disabled provider from a disconnected one', () => {
    expect(describeKnowledge(target('off', [disabled]))).toContain('graphify: disabled (server unset)')
  })

  it('reports off mode with no providers configured', () => {
    expect(describeKnowledge(target('off', []))).toBe('knowledge mode: off')
  })
})

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('/knowledge through the real command registry', () => {
  it('is registered and reports status without a model message', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Commands)
    await ctx.plugin(KnowledgeRouter, { mode: 'assisted', gitnexus: { enabled: true } })
    const harness = await mountAgentLoopTestHarness(ctx)
    const agent = await harness.create(SessionId('command-agent'))
    context = ctx

    expect(ctx.commands.find(agent, 'knowledge')).toBeDefined()

    const execution = await ctx.commands.execute(agent, '/knowledge', [], new AbortController().signal)
    expect(execution?.result.kind).toBe('success')
    const text = execution?.result.kind === 'success' ? execution.result.text ?? '' : ''
    expect(text).toContain('knowledge mode: assisted')
    expect(text).toContain('gitnexus: disconnected (server gitnexus)')
    expect(text).toContain('graphify: disabled (server unset)')
  }, 30_000)

  it('is registered even when the mode is off, so an operator can confirm it', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Commands)
    await ctx.plugin(KnowledgeRouter, {})
    const harness = await mountAgentLoopTestHarness(ctx)
    const agent = await harness.create(SessionId('command-agent-off'))
    context = ctx

    const execution = await ctx.commands.execute(agent, '/knowledge', [], new AbortController().signal)
    const text = execution?.result.kind === 'success' ? execution.result.text ?? '' : ''
    expect(text).toContain('knowledge mode: off')
  }, 30_000)
})
