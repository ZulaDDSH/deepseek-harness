import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime, { NO_START_CAPABILITIES } from '@deepseek-ai/dsh-subagent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { defineContentToolFixture } from '../../../test-support/tool-testkit/src/index.ts'
import { HarnessSdkJsonRpcServer } from '../src/server.ts'

type Script = ConstructorParameters<typeof MockAdapter>[0]

async function setup(script: Script) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sdk-cancel-'))
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(JsonlSessionPersistence, { root })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const notifications: { method: string; params: Record<string, unknown> }[] = []
  const server = new HarnessSdkJsonRpcServer(ctx, {
    request: () => Promise.reject(new Error('the server must not request the client')),
    notify: (method, params) => { notifications.push({ method, params: params as Record<string, unknown> }) },
  })
  await server.initialize({ cwd: root, provider: 'mock', model: 'mock' })
  const agentOf = (id: string) => ctx.agents.get(brandString<SessionId>(id))!
  const text = (value: string) => [{ type: 'text' as const, text: value }]
  const turnEnds = (id: string) => notifications.flatMap(({ method, params }) => {
    const event = params.event as { type?: string; data?: { reason?: unknown } } | undefined
    return method === 'session.event' && params.sessionId === id && event?.type === 'turn/end' ? [event.data?.reason] : []
  })
  return {
    ctx, server, adapter, agentOf, text, turnEnds,
    dispose: async () => {
      await server.shutdown()
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

const ABORTED = { kind: 'aborted', reason: { kind: 'user' } }

describe('SDK session/cancel', () => {
  it('stops a turn streaming from the model and lets session/wait settle', async () => {
    const { server, adapter, agentOf, text, turnEnds, dispose } = await setup(['hang'])
    try {
      await server.prompt({ sessionId: 'main', contentBlocks: text('go') })
      await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
      expect(agentOf('main').status).toBe('running')
      await expect(server.handleRequest('session/cancel', { sessionId: 'main' })).resolves.toEqual({ cancelled: true })
      await server.wait({ sessionId: 'main' })
      expect(agentOf('main').status).toBe('idle')
      expect(turnEnds('main')).toEqual([ABORTED])
    } finally {
      await dispose()
    }
  })

  it('stops a running tool through its execution signal', async () => {
    const { ctx, server, agentOf, text, turnEnds, dispose } = await setup([toolCallResponse('call-1', 'blocked', {})])
    try {
      const started = Promise.withResolvers<undefined>()
      let toolSignal: AbortSignal | undefined
      ctx.tools.register(defineContentToolFixture({
        name: 'blocked',
        description: 'wait for cancellation',
        parameters: {},
        execute: async (_args, exec) => {
          toolSignal = exec.signal
          started.resolve(undefined)
          await new Promise<void>((resolve) => { exec.signal?.addEventListener('abort', () => { resolve() }, { once: true }) })
          return [{ type: 'text', text: 'cancelled' }]
        },
      }))
      await server.prompt({ sessionId: 'main', contentBlocks: text('go') })
      await started.promise
      server.cancel({ sessionId: 'main' })
      await server.wait({ sessionId: 'main' })
      expect(toolSignal?.aborted).toBe(true)
      expect(agentOf('main').status).toBe('idle')
      expect(turnEnds('main')).toEqual([ABORTED])
    } finally {
      await dispose()
    }
  })

  it('leaves an independent Session running', async () => {
    const { server, adapter, agentOf, text, turnEnds, dispose } = await setup(['hang', 'hang'])
    try {
      await server.prompt({ sessionId: 'a', contentBlocks: text('go') })
      await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
      await server.prompt({ sessionId: 'b', contentBlocks: text('go') })
      await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
      server.cancel({ sessionId: 'a' })
      await agentOf('a').whenIdle()
      expect(agentOf('a').status).toBe('idle')
      expect(agentOf('b').status).toBe('running')
      expect(turnEnds('b')).toEqual([])
      server.cancel({ sessionId: 'b' })
      await server.wait({ sessionId: 'b' })
      expect(turnEnds('b')).toEqual([ABORTED])
    } finally {
      await dispose()
    }
  })

  it.each(['prompt', 'query'] as const)('rejects a %s still being admitted instead of queueing it afterwards', async (method) => {
    const { ctx, server, adapter, agentOf, text, dispose } = await setup([textResponse('must not run')])
    try {
      const gate = Promise.withResolvers<undefined>()
      const entered = Promise.withResolvers<undefined>()
      const create = ctx.agents.create.bind(ctx.agents)
      vi.spyOn(ctx.agents, 'create').mockImplementation(async (...args) => {
        entered.resolve(undefined)
        await gate.promise
        return create(...args)
      })
      const params = { sessionId: 'main', contentBlocks: text('go') }
      const pending = method === 'prompt' ? server.prompt(params) : server.query(params)
      const settled = expect(pending).rejects.toThrow('cancelled')
      await entered.promise
      expect(server.cancel({ sessionId: 'main' })).toEqual({ cancelled: false })
      gate.resolve(undefined)
      await settled
      expect(adapter.requests).toHaveLength(0)
      expect(agentOf('main').status).toBe('idle')
      await server.prompt({ sessionId: 'main', contentBlocks: text('again') })
      await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    } finally {
      await dispose()
    }
  })

  it('discards input queued behind the cancelled turn', async () => {
    const { server, adapter, agentOf, text, dispose } = await setup(['hang', textResponse('must not run')])
    try {
      await server.prompt({ sessionId: 'main', contentBlocks: text('first') })
      await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
      await server.prompt({ sessionId: 'main', contentBlocks: text('queued') })
      server.cancel({ sessionId: 'main' })
      await server.wait({ sessionId: 'main' })
      expect(agentOf('main').status).toBe('idle')
      expect(adapter.requests).toHaveLength(1)
    } finally {
      await dispose()
    }
  })

  it('interrupts a live descendant of the Session', async () => {
    const { ctx, server, agentOf, text, turnEnds, dispose } = await setup(['hang'])
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let closeChild: (() => Promise<void>) | undefined
    try {
      await server.prompt({ sessionId: 'main', contentBlocks: text('first') })
      const parent = agentOf('main')
      server.cancel({ sessionId: 'main' })
      await parent.whenIdle()
      ctx.subagents.registerProvider({
        name: 'local-test', capabilities: NO_START_CAPABILITIES, inheritsParentContext: false,
        prepareContinuable: () => Promise.resolve({}),
      })
      ctx.on('agent/pre-step', async ({ agent }, next) => {
        if (agent.session.header.parentSession !== undefined) {
          entered.resolve(undefined)
          await release.promise
        }
        return next()
      })
      const started = await ctx.subagents.startActivation({
        provider: 'local-test', label: 'child', delivery: 'caller', signal: new AbortController().signal,
        parent, prompt: text('work'),
      })
      closeChild = () => started.dispose()
      const child = ctx.agents.get(started.childId)!
      await entered.promise
      expect(server.cancel({ sessionId: 'main' })).toEqual({ cancelled: true })
      release.resolve(undefined)
      await child.whenIdle()
      expect(turnEnds(String(child.id))).toEqual([{ kind: 'aborted', reason: { kind: 'user' } }])
    } finally {
      release.resolve(undefined)
      await closeChild?.()
      await dispose()
    }
  })

  it('never creates a Session and validates its request', async () => {
    const { ctx, server, dispose } = await setup([])
    try {
      expect(server.cancel({ sessionId: 'missing' })).toEqual({ cancelled: false })
      expect(ctx.agents.get(brandString<SessionId>('missing'))).toBeUndefined()
      await expect(server.wait({ sessionId: 'missing' })).rejects.toThrow('unknown SDK session')
      for (const params of [undefined, {}, { sessionId: '' }, { sessionId: 3 }]) {
        await expect(server.handleRequest('session/cancel', params)).rejects.toThrow('non-empty sessionId')
      }
    } finally {
      await dispose()
    }
  })

  it('requires an initialized server', () => {
    const server = new HarnessSdkJsonRpcServer(new Context(), { request: () => Promise.reject(new Error('unused')), notify: () => {} })
    expect(() => server.cancel({ sessionId: 'main' })).toThrow('not initialized')
  })
})
