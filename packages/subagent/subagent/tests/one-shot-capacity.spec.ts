import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentCapabilities, SubagentProvider, SubagentResult } from '@deepseek-ai/dsh-subagent'

const NO_CAPABILITIES: SubagentCapabilities = {
  agentOptions: false,
  outputSchema: false,
  depthLimit: false,
  toolFilter: false,
  persona: false,
}

/** One macrotask, enough for the agents-injected manager and settlement reactions to run. */
const macrotask = () => new Promise<void>(resolve => setImmediate(resolve))

/** A parent identity distinct from any other test parent; the registry keys pools by Agent identity. */
function parentAgent(id: string): Agent {
  return { id: SessionId(id) } as never
}

function startRequest(parent: Agent) {
  return {
    prompt: [{ type: 'text' as const, text: 'x' }],
    parent,
    signal: new AbortController().signal,
  }
}

/** A one-shot provider whose runs settle only when the test resolves their deferred result. */
function gatedProvider() {
  const results: PromiseWithResolvers<SubagentResult>[] = []
  const state = { starts: 0, failNext: false }
  const provider: SubagentProvider = {
    name: 'p',
    capabilities: NO_CAPABILITIES,
    inheritsParentContext: false,
    async start() {
      state.starts += 1
      if (state.failNext) {
        state.failNext = false
        throw new Error('provider start failed')
      }
      const result = Promise.withResolvers<SubagentResult>()
      results.push(result)
      return {
        id: SessionId(`c${state.starts}`),
        localAgent: undefined,
        result: result.promise,
        dispose: async () => {},
      }
    },
  }
  return { provider, state, results }
}

async function bench(maxActiveSubagents: number) {
  const ctx = new Context()
  ctx.provide('agents', {} as never)
  await ctx.plugin(SubagentRuntime, { maxActiveSubagents })
  await macrotask()
  const gate = gatedProvider()
  ctx.subagents.registerProvider(gate.provider)
  return { ctx, ...gate }
}

describe('one-shot runs share the delegating parent capacity pool', () => {
  it('rejects a third one-shot run at capacity and admits another once a result settles', async () => {
    const { ctx, state, results } = await bench(2)
    const parent = parentAgent('root')
    await ctx.subagents.start('p', startRequest(parent))
    await ctx.subagents.start('p', startRequest(parent))
    await expect(ctx.subagents.start('p', startRequest(parent)))
      .rejects.toMatchObject({ code: 'ACTIVATION_LIMIT_REACHED' })
    expect(state.starts).toBe(2)

    results[0]!.resolve({ output: [], stopReason: 'completed' })
    await macrotask()
    await ctx.subagents.start('p', startRequest(parent))
    expect(state.starts).toBe(3)
  })

  it('releases the reserved slot when provider.start throws', async () => {
    const { ctx, state } = await bench(2)
    const parent = parentAgent('root')
    state.failNext = true
    await expect(ctx.subagents.start('p', startRequest(parent))).rejects.toThrow('provider start failed')
    await ctx.subagents.start('p', startRequest(parent))
    await ctx.subagents.start('p', startRequest(parent))
    expect(state.starts).toBe(3)
  })

  it('gives each root parent its own pool', async () => {
    const { ctx, state } = await bench(2)
    const first = parentAgent('root')
    const second = parentAgent('other')
    await ctx.subagents.start('p', startRequest(first))
    await ctx.subagents.start('p', startRequest(first))
    await ctx.subagents.start('p', startRequest(second))
    await ctx.subagents.start('p', startRequest(second))
    expect(state.starts).toBe(4)
    await expect(ctx.subagents.start('p', startRequest(first)))
      .rejects.toMatchObject({ code: 'ACTIVATION_LIMIT_REACHED' })
  })

  it('exposes the configured maxActiveSubagents limit to workflow fan-out sizing', async () => {
    const { ctx } = await bench(4)
    expect(ctx.subagents.activeSubagentLimit()).toBe(4)
  })

  it('imposes no limit without the agents service, so no pool exists', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime, { maxActiveSubagents: 1 })
    const gate = gatedProvider()
    ctx.subagents.registerProvider(gate.provider)
    const parent = parentAgent('root')
    await ctx.subagents.start('p', startRequest(parent))
    await ctx.subagents.start('p', startRequest(parent))
    await ctx.subagents.start('p', startRequest(parent))
    expect(gate.state.starts).toBe(3)
  })
})
