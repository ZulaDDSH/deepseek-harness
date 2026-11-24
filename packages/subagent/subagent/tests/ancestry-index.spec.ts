import { mountWorkingDirectoryFixture } from './working-directory-fixture.ts'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionCache from '@deepseek-ai/dsh-session-projection-cache'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import SubagentRuntime from '../src/index.ts'
import { creationParentFromCheckpoint } from '../src/creation-checkpoint.ts'
import { TestSessionQuery } from './test-session-query.ts'
import { forbidCatalogScans, subagentManager } from './manager-internals.ts'

type CachedRows = ReturnType<SessionProjectionCache['cachedRows']>

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup(responses: ReturnType<typeof textResponse>[], withCache = false) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-ancestry-index-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: root })
  await ctx.plugin(ApprovalService)
  if (withCache) {
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const domain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', domain)
    ctx.provide('storageDomain', domain)
    await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 1_000, writeIntervalMs: 60_000 })
  }
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
  it('delivers into a dormant child without observing the live root or scanning its catalog', { timeout: 20_000 }, async () => {
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
    forbidCatalogScans(ctx)
    await manager.deliverPrompt(started.childId, [{ type: 'text', text: 'continue please' }], {
      delivery: 'queue', source: { kind: 'user' }, signal: new AbortController().signal,
    })
    await waitNoActivation(ctx, started.childId)

    const observed = observe.mock.calls.map(call => call[0])
    expect(observed).toContain(started.childId)
    expect(observed).not.toContain(parent.session.id)
  })

  async function dormantChain(withCache: boolean) {
    const { ctx, parent } = await setup([
      textResponse('leaf done'),
      textResponse('mid done'),
      textResponse('leaf again'),
    ], withCache)
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
    return { ctx, manager, mid: mid.childId, leaf: leaf.childId, signal }
  }

  async function continueLeaf({ ctx, manager, leaf, signal }: Awaited<ReturnType<typeof dormantChain>>) {
    forbidCatalogScans(ctx)
    const observe = vi.spyOn(ctx.sessionQuery, 'observeSession')
    const inspect = vi.spyOn(ctx.sessionQuery, 'inspectSession')
    const prepare = vi.spyOn(ctx.sessions, 'prepare')
    const open = vi.spyOn(ctx.sessionPersistence, 'open')
    await manager.deliverPrompt(leaf, [{ type: 'text', text: 'continue please' }], {
      delivery: 'queue', source: { kind: 'user' }, signal,
    })
    await waitNoActivation(ctx, leaf)
    const ids = (calls: readonly (readonly unknown[])[]) => calls.map(call => call[0])
    return {
      observed: ids(observe.mock.calls),
      inspected: ids(inspect.mock.calls),
      prepared: ids(prepare.mock.calls),
      opened: ids(open.mock.calls),
    }
  }

  it('falls back to a full inspection of a dormant intermediate creator when no cache is mounted', { timeout: 30_000 }, async () => {
    const chain = await dormantChain(false)
    const reads = await continueLeaf(chain)

    expect(reads.observed).not.toContain(chain.mid)
    expect(reads.inspected).toContain(chain.mid)
  })

  it('resolves a dormant intermediate creator from its checkpoint row without reading its log', { timeout: 30_000 }, async () => {
    const chain = await dormantChain(true)
    const { ctx, mid, leaf } = chain
    await vi.waitFor(async () => {
      expect(await ctx.sessionQuery.inspectCheckpoint(mid, cut => creationParentFromCheckpoint(cut, leaf))).toMatchObject({ present: true })
    }, { timeout: 15_000 })
    const reads = await continueLeaf(chain)

    expect(reads.observed).not.toContain(mid)
    expect(reads.inspected).not.toContain(mid)
    expect(reads.prepared).not.toContain(mid)
    expect(reads.opened).not.toContain(mid)
    expect(reads.opened).toContain(leaf)
  })

  it.each([
    ['no checkpoint record', () => undefined],
    ['a version-7 catalog row', (cached: CachedRows) => cached && {
      ...cached, rows: { ...cached.rows, subagentCatalog: { ...cached.rows['subagentCatalog']!, ver: 7 } },
    }],
    ['a stale row that lacks the child', (cached: CachedRows) => cached && {
      ...cached, rows: { ...cached.rows, subagentCatalog: { ...cached.rows['subagentCatalog']!, val: { ...(cached.rows['subagentCatalog']!.val as object), children: {} } } },
    }],
  ])('takes the full path for a dormant creator with %s', { timeout: 30_000 }, async (_name, degrade) => {
    const chain = await dormantChain(true)
    const { ctx, mid, leaf } = chain
    await vi.waitFor(async () => {
      expect(await ctx.sessionQuery.inspectCheckpoint(mid, cut => creationParentFromCheckpoint(cut, leaf))).toMatchObject({ present: true })
    }, { timeout: 15_000 })
    const real = ctx.sessionProjectionCache.cachedRows.bind(ctx.sessionProjectionCache)
    vi.spyOn(ctx.sessionProjectionCache, 'cachedRows').mockImplementation(header => degrade(real(header)))
    const reads = await continueLeaf(chain)

    expect(reads.inspected).toContain(mid)
  })
})
