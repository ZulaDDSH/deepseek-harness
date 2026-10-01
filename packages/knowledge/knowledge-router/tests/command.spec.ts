/**
 * The `/knowledge` status command: the report format, and that the command is
 * registered and executable through the real human-command registry.
 */

import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Commands from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import KnowledgeRouter from '../src/index.ts'
import { registerGraphifyCommand } from '../src/graphify-command.ts'
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


describe('/graphify through the real command registry', () => {
  it('invokes native commands with the caller workspace and preserves quoted arguments', async () => {
    const ctx = new Context()
    context = ctx
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Commands)
    const harness = await mountAgentLoopTestHarness(ctx)
    const agent = await harness.create(SessionId('graphify-command-agent'), {}, { cwd: process.cwd() })
    const cwd = agent.session.header.cwd!
    const calls: { command: string; args: readonly string[] }[] = []
    registerGraphifyCommand(ctx, { command: 'uv', args: ['tool', 'run', '--from', 'graphifyy==0.9.73', 'graphify'] },
      async (command, args, signal, window) => {
        expect(signal.aborted).toBe(false)
        expect(window).toBe('hidden')
        calls.push({ command, args })
        return { stdout: 'Official Graphify result', stderr: '' }
      })
    const execution = await ctx.commands.execute(agent, '/graphify query "Memory workspace relationships"', [], new AbortController().signal)
    expect(execution?.result).toEqual({ kind: 'success', text: 'Official Graphify result' })
    expect(calls[0]).toEqual({ command: 'uv', args: ['tool', 'run', '--from', 'graphifyy==0.9.73', 'graphify',
      'query', 'Memory workspace relationships', '--graph', join(cwd, 'graphify-out', 'graph.json')] })
    await ctx.commands.execute(agent, '/graphify update', [], new AbortController().signal)
    expect(calls.slice(1).map(call => call.args.slice(5))).toEqual([
      ['update', cwd, '--no-cluster'],
      ['cluster-only', cwd, '--graph', join(cwd, 'graphify-out', 'graph.json'), '--no-label', '--no-viz'],
      ['export', 'html', '--graph', join(cwd, 'graphify-out', 'graph.json')],
    ])
    const invalid = await ctx.commands.execute(agent, '/graphify install', [], new AbortController().signal)
    expect(invalid?.result.kind).toBe('error')
    const malformed = await ctx.commands.execute(agent, '/graphify query "unclosed', [], new AbortController().signal)
    expect(malformed?.result.kind).toBe('error')
    expect(calls).toHaveLength(4)
  }, 30_000)
})
