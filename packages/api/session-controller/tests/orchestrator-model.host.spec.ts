import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmCallConfig, LlmModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createVolatile, updateVolatile } from '../../../../vendor/cosmokit/src/volatile.ts'
import { sessionModelOf } from '../src/run-options.ts'
import { createSessionTestRemote } from './test-remote.ts'

const PROVIDER = 'deepseek-official'
const PICKED = { provider: PROVIDER, model: 'deepseek-reasoner' }
const ORCHESTRATOR = { provider: PROVIDER, model: 'deepseek-chat', reasoningEffort: 'high' }

class CatalogAdapter extends LlmAdapter {
  override providerInfo(provider: string) {
    return { id: provider, name: 'DeepSeek' }
  }

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([
      { provider: PROVIDER, id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { provider: PROVIDER, id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
    ])
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Selection tests never enter provider streaming.
  }
}

function orchestratorSetup(enabled: boolean) {
  return {
    enabled,
    reviewRounds: 0,
    roles: { orchestrator: { mode: 'fixed', route: { backend: 'llm', ...ORCHESTRATOR } } },
  }
}

describe('orchestrator route as the Session model', () => {
  it('runs a top-level Session on the global fixed orchestrator while the global setup is on, and on its pick once it is off', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { personaPrefix: '' })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AgentRegistry)
    ctx.llm.registerAdapter([PROVIDER], new CatalogAdapter())
    const session = ctx.sessions.create()
    const reject = (): never => { throw new Error('this fixture does not mutate the inbox') }
    const agent: Agent = {
      id: session.id, session, options: {}, ctx, status: 'idle',
      inbox: {
        nextTurn: [], nextStep: [], append: reject, prepend: reject, replace: reject, remove: reject, splice: reject, clear: reject,
      },
      steer: vi.fn(), followup: vi.fn(), cancel: vi.fn(), send: vi.fn(), inject: vi.fn(),
      whenIdle: () => Promise.resolve(), runMaintenance: task => task(new AbortController().signal),
    }
    await ctx.agents.register(agent)
    const globalSetup = createVolatile<unknown>(orchestratorSetup(true))
    const remote = createSessionTestRemote(ctx, {
      defaultModelSelection: () => PICKED,
      cwd: '/tmp',
      subagentSetup: globalSetup,
    })
    expect(await remote.selectModel({ sessionId: session.id, ...PICKED })).toMatchObject({ ok: true })

    const signal = new AbortController().signal
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed' }
    const requestConfig = async (): Promise<LlmCallConfig> => {
      await ctx.systemPrompt.assemble()
      return agentEvents(ctx, agent).waterfall('agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed))
    }

    expect(sessionModelOf(ctx, session)).toEqual(ORCHESTRATOR)
    await expect(requestConfig()).resolves.toMatchObject(ORCHESTRATOR)

    updateVolatile(globalSetup, createVolatile<unknown>(orchestratorSetup(false)))
    expect(sessionModelOf(ctx, session)).toEqual(PICKED)
    await expect(requestConfig()).resolves.toMatchObject(PICKED)
    await ctx.fiber.dispose()
  })
})
