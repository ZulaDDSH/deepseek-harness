import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
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
    await mountAgentLoopTestDependencies(ctx)
    await mountAgentLoopTestHarness(ctx)
    ctx.llm.registerAdapter([PROVIDER], new CatalogAdapter())
    const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-model-'))
    const globalSetup = createVolatile<unknown>(orchestratorSetup(true))
    const remote = await createSessionTestRemote(ctx, {
      defaultModelSelection: () => PICKED,
      cwd,
      subagentSetup: globalSetup,
    })
    const created = await remote.create({ cwd })
    if (!created.ok) throw new Error('the Session could not be created')
    const sessionId = created.value.sessionId
    expect(await remote.selectModel({ sessionId, ...PICKED })).toMatchObject({ ok: true })
    const agent = ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('the created Session has no live Agent')

    expect(sessionModelOf(ctx, agent.session)).toEqual(ORCHESTRATOR)
    expect(agent.model.current()).toEqual(ORCHESTRATOR)

    updateVolatile(globalSetup, createVolatile<unknown>(orchestratorSetup(false)))
    expect(sessionModelOf(ctx, agent.session)).toEqual(PICKED)
    expect(agent.model.current()).toEqual(PICKED)
    await ctx.fiber.dispose()
    rmSync(cwd, { recursive: true, force: true })
  })
})
