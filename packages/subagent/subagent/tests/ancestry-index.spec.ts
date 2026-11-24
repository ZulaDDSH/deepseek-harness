import { mountWorkingDirectoryFixture } from './working-directory-fixture.ts'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentRuntime from '../src/index.ts'
import { TestSessionQuery } from './test-session-query.ts'
import { subagentManager } from './manager-internals.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup(responses: ReturnType<typeof textResponse>[]) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-ancestry-index-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: root })
  await ctx.plugin(ApprovalService)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TestSessionQuery)
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(responses))
  const parent = await ctx.agentLoop.create(brandString<SessionId>('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent }
}

async function waitNoActivation(ctx: Context, childId: SessionId): Promise<void> {
  await vi.waitFor(() => {
    expect(ctx.agents.get(childId)).toBeUndefined()
  }, { timeout: 15_000 })
}

describe('subagent creator walk under a live root', () => {
  it('delivers into a dormant child without observing the live root or re-reading its catalog', { timeout: 20_000 }, async () => {
    const { ctx, parent } = await setup([textResponse('child done'), textResponse('resumed child done')])
    const started = await ctx.subagents.startActivation({
      provider: 'spawn',
      label: 'child task',
      prompt: [{ type: 'text', text: 'child task' }],
      parent,
      signal: new AbortController().signal,
      delivery: 'parent',
    })
    await waitNoActivation(ctx, started.childId)

    const manager = subagentManager(ctx)
    const observe = vi.spyOn(ctx.sessionQuery, 'observeSession')
    const catalogOf = vi.spyOn(manager['host'], 'catalogChildrenOf')
    await manager.deliverPrompt(started.childId, [{ type: 'text', text: 'continue please' }], {
      delivery: 'queue', source: { kind: 'user' }, signal: new AbortController().signal,
    })
    await waitNoActivation(ctx, started.childId)

    const observed = observe.mock.calls.map(call => call[0])
    expect(observed).toContain(started.childId)
    expect(observed).not.toContain(parent.session.id)
    expect(catalogOf).not.toHaveBeenCalled()
  })

  it('resolves a dormant intermediate creator through its keyed cut, not an observation', { timeout: 30_000 }, async () => {
    const { ctx, parent } = await setup([
      textResponse('leaf done'),
      textResponse('mid done'),
      textResponse('leaf again'),
    ])
    let releaseMid = false
    ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      if (releaseMid || subject.session.header.parentSession !== parent.id) return next()
      return { kind: 'reject' as const }
    })
    const signal = new AbortController().signal
    const mid = await ctx.subagents.startActivation({
      provider: 'spawn', label: 'mid task', prompt: [{ type: 'text', text: 'mid task' }], parent, signal, delivery: 'parent',
    })
    const leaf = await ctx.subagents.startActivation({
      provider: 'spawn',
      label: 'leaf task',
      prompt: [{ type: 'text', text: 'leaf task' }],
      parent: ctx.agents.get(mid.childId)!,
      signal,
      delivery: 'parent',
    })
    await waitNoActivation(ctx, leaf.childId)

    releaseMid = true
    const manager = subagentManager(ctx)
    await manager.deliverPrompt(mid.childId, [{ type: 'text', text: 'wake' }], {
      delivery: 'queue', source: { kind: 'user' }, signal,
    })
    await waitNoActivation(ctx, mid.childId)

    const observe = vi.spyOn(ctx.sessionQuery, 'observeSession')
    const inspect = vi.spyOn(ctx.sessionQuery, 'inspectSession')
    await manager.deliverPrompt(leaf.childId, [{ type: 'text', text: 'continue please' }], {
      delivery: 'queue', source: { kind: 'user' }, signal,
    })
    await waitNoActivation(ctx, leaf.childId)

    expect(observe.mock.calls.map(call => call[0])).not.toContain(mid.childId)
    expect(inspect.mock.calls.map(call => call[0])).toContain(mid.childId)
  })
})
