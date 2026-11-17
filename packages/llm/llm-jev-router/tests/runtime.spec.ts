import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { JevRouter, apply, createJevClient, selectRelevantGrepMatches, stateForMessages, type Config, type JevClient, type RuntimeConfig } from '../src/index.ts'
import * as jevPlugin from '../src/index.ts'
import { createVolatile, updateVolatile } from '../../../../vendor/cosmokit/src/volatile.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime, { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'

const config = {
  enabled: true, apiKeyEnv: 'JEV_TEST_KEY', endpoint: 'https://jev.example.test/v1', model: 'jev-test',
  timeoutMs: 1000, minConfidence: 0.8, stateMaxChars: 1000, fallback: 'keep', failOpen: true,
  routes: [{ id: 'small', provider: 'target', model: 'small', description: 'Routine work' }],
} satisfies Config
const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'fix routing' }] })
const routed = { provider: 'target', model: 'small' }
const signal = new AbortController().signal
const contexts: Context[] = []

class TargetAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('not exercised')
  }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function mount(overrides: Partial<Config> = {}, credentials?: Record<string, string>) {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
    { source: 'process', values: { JEV_TEST_KEY: 'fixture-key' } },
  ]))
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['target'], new TargetAdapter())
  if (credentials !== undefined) await ctx.plugin(MemoryCredentials, credentials)
  const fiber = await ctx.plugin(jevPlugin, { ...config, ...overrides, routes: [...(overrides.routes ?? config.routes)] })
  const agent = { session: Session.create(SessionId('jev-runtime')), ctx, options: {} } as Agent
  const events = agentEvents(ctx, agent)
  const preStep = (step = 1, currentSignal = signal, kind: 'enter' | 'reject' = 'enter', turn = 1) => events.waterfall(
    'agent/pre-step', { turn, step, messages: [input], signal: currentSignal, modelSelection: routed },
    () => Promise.resolve(kind === 'enter' ? { kind, messages: [input] } : { kind }),
  )
  const route = (step = 1, currentSignal = signal, turn = 1) => events.waterfall(
    'agent/route', { turn, step, messages: [input], signal: currentSignal },
    () => Promise.resolve(undefined),
  )
  return { ctx, fiber, agent, preStep, route }
}

function answer(...values: unknown[]) {
  let call = 0
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(values[Math.min(call++, values.length - 1)]))
  vi.stubGlobal('fetch', fetchImpl)
  return fetchImpl
}

const fixedOrchestrator = (model: string) => ({
  enabled: true, reviewRounds: 0, roles: { orchestrator: { mode: 'fixed', route: { backend: 'llm', provider: 'target', model } } },
})

async function mountWithProjections(globalSetup?: unknown) {
  const mounted = await mount()
  await mounted.ctx.plugin(SessionProjectionRegistry)
  if (globalSetup !== undefined) mounted.ctx.provide('sessionController', { defaultSubagentSetup: () => globalSetup } as never)
  return mounted
}

describe('Jev routing lifecycle', () => {
  it('decides once per turn, reuses it for every step, and releases its provider and listeners', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { ctx, fiber, preStep, route } = await mount()
    expect(ctx.get('llm')!.listConfigurableProviders()).toMatchObject([{ provider: 'jev-router' }])
    expect(await route(1, AbortSignal.abort())).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await route()).toEqual(routed)
    expect(await preStep()).toEqual({ kind: 'enter', messages: [input] })
    expect(await route(2)).toEqual(routed)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(await route(1, signal, 2)).toEqual(routed)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect((await preStep(1, signal, 'enter', 3)).kind).toBe('enter')
    await fiber.dispose()
    expect(ctx.get('llm')!.listConfigurableProviders()).toEqual([])
    expect(await route(1, signal, 3)).toBeUndefined()
  })

  it('returns an unrouted step to the configured model instead of the previous route', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } }, { answers: { route: { choice: 'missing', confidence: 1 } } })
    const { agent, route } = await mount()
    expect(await route()).toEqual(routed)
    Object.assign(agent.options, { provider: 'base', model: 'base', reasoningEffort: 'high' })
    expect(await route(1, signal, 2)).toEqual({ provider: 'base', model: 'base', reasoningEffort: 'high' })
  })

  it('delegates disabled, aborted, empty-route and keep decisions', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'missing', confidence: 1 } } })
    for (const overrides of [{ enabled: false }, { routes: [] }, {}]) {
      const { preStep, route } = await mount(overrides)
      expect(await route()).toBeUndefined()
      expect(await route(1, AbortSignal.abort())).toBeUndefined()
      expect(await preStep(1, signal, 'reject')).toEqual({ kind: 'reject' })
      expect(await preStep(1, AbortSignal.abort())).toEqual({ kind: 'enter', messages: [input] })
      expect(await preStep()).toEqual({ kind: 'enter', messages: [input] })
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('delegates a later step unchanged after the live config disables routing', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { fiber, route } = await mount()
    expect(await route()).toEqual(routed)
    updateVolatile(fiber.effectiveConfig as RuntimeConfig, createVolatile({ ...config, routes: [...config.routes], enabled: false }))
    expect(await route(1, signal, 2)).toBeUndefined()
  })

  it('preserves or rejects the admitted input according to failure policy', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('offline') }))
    for (const failOpen of [true, false]) {
      const { preStep, route } = await mount({ failOpen })
      expect(await route()).toBeUndefined()
      expect((await preStep()).kind).toBe(failOpen ? 'enter' : 'reject')
    }
  })

  it('does not retry a failed decision on later steps of the same turn', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetchImpl)
    const { preStep, route } = await mount()
    expect(await route()).toBeUndefined()
    expect((await preStep()).kind).toBe('enter')
    expect(await route(2)).toBeUndefined()
    expect((await preStep(2)).kind).toBe('enter')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await route(1, signal, 2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{ choice: 'small', confidence: 0.9 }, {}, { route: 'small', provider: 'target', model: 'small' }],
    [{ choice: 'small', confidence: 0.01 }, { fallback: 'safe' }, { route: 'safe', provider: 'target', model: 'safe' }],
    [{ choice: 'small', confidence: 0.01 }, {}, {}],
  ])('records Jev\'s pick %o and the route actually applied', async (pick, overrides, applied) => {
    answer({ answers: { route: pick } })
    const routes = [...config.routes, { id: 'safe', provider: 'target', model: 'safe', description: 'Fallback' }]
    const { agent, route } = await mount({ ...overrides, routes })
    await route()
    expect(agent.session.snapshotEvents().filter(event => event.type === 'jev/decision').map(event => event.data))
      .toEqual([{ turn: 1, step: 1, ...pick, ...applied }])
  })

  it('never offers or applies a route on an unregistered provider', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'ghost', confidence: 1 } } })
    const routes = [...config.routes, { id: 'ghost', provider: 'ghost', model: 'ghost', description: 'Unregistered' }]
    const { agent, route } = await mount({ routes })
    expect(await route()).toBeUndefined()
    const [, init] = fetchImpl.mock.calls[0]!
    const sent = JSON.parse(init?.body as string) as { questions: { route: { criteria: unknown } } }
    expect(sent.questions.route.criteria).toEqual({ small: 'Routine work' })
    expect(agent.session.snapshotEvents().filter(event => event.type === 'jev/decision').map(event => event.data))
      .toEqual([{ turn: 1, step: 1, choice: 'ghost', confidence: 1, unroutable: true }])
  })

  it('skips Jev when no configured route is registered', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'ghost', confidence: 1 } } })
    const { route } = await mount({ routes: [{ id: 'ghost', provider: 'ghost', model: 'g', description: 'x' }] })
    expect(await route()).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('records a decision failure as a jev/decision event', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.reject(new Error('offline'))))
    const thrown = await mount()
    await thrown.route()
    expect(thrown.agent.session.snapshotEvents().filter(event => event.type === 'jev/decision').map(event => event.data))
      .toEqual([{ turn: 1, step: 1, error: expect.stringContaining('offline') as string, rejected: false }])
  })

  it('records a stopped turn when the router fails closed', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.reject(new Error('offline'))))
    const stopped = await mount({ failOpen: false })
    expect(await stopped.route()).toBeUndefined()
    expect(await stopped.preStep()).toEqual({ kind: 'reject' })
    expect(stopped.agent.session.snapshotEvents().filter(event => event.type === 'jev/decision').map(event => event.data))
      .toEqual([{ turn: 1, step: 1, error: expect.stringContaining('offline') as string, rejected: true }])
  })

  it('falls back to the Agent route only when it names both provider and model', async () => {
    answer({ answers: { route: { choice: 'missing', confidence: 1 } } })
    const { agent, route } = await mount()
    Object.assign(agent.options, { provider: 'base' })
    expect(await route()).toBeUndefined()
    Object.assign(agent.options, { model: 'base' })
    expect(await route()).toEqual({ provider: 'base', model: 'base' })
  })

  it('returns an unrouted step to the Session model selection when one is stored', async () => {
    answer({ answers: { route: { choice: 'missing', confidence: 1 } } })
    const { ctx, route } = await mountWithProjections()
    ctx.provide('agents', { modelSelectionOf: () => ({ pending: { provider: 'chosen', model: 'pick' } }) } as never)
    expect(await route()).toEqual({ provider: 'chosen', model: 'pick' })
  })

  it('leaves an orchestrator-fixed Session on its pinned route and never asks Jev', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    let fixed = false
    const { ctx, preStep, route } = await mountWithProjections()
    ctx.provide('sessionController', { defaultSubagentSetup: () => (fixed ? fixedOrchestrator('pinned') : undefined) } as never)
    expect(await route()).toEqual(routed)
    fixed = true
    expect(await route(1, signal, 2)).toBeUndefined()
    expect((await preStep(1, signal, 'enter', 2)).kind).toBe('enter')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('uses the credential provider rather than falling back to the environment', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const resolved = await mount({}, { JEV_TEST_KEY: 'provider-fixture-key' })
    await resolved.route()
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer provider-fixture-key')
    const missing = await mount({}, {})
    expect(await missing.route()).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    { endpoint: 'invalid' }, { endpoint: 'ftp://jev.example.test' },
    { endpoint: 'https://user@jev.example.test' }, { endpoint: 'https://:password@jev.example.test' },
    { endpoint: 'https://jev.example.test?q=1' }, { endpoint: 'https://jev.example.test#fragment' },
    { routes: [config.routes[0]!, config.routes[0]!] }, { fallback: 'missing' },
  ])('refuses invalid deployment settings %j', (overrides) => {
    expect(() => { apply(new Context(), jevPlugin.Config({ ...config, ...overrides })) }).toThrow('jev-router:')
  })
})

describe('Jev routing through the real agent loop', () => {
  async function mountLoop(script: StreamChunk[][], overrides: Partial<Config> = {}) {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { JEV_TEST_KEY: 'fixture-key' } },
    ]))
    await mountAgentLoopTestDependencies(ctx)
    const adapter = new MockAdapter(script)
    ctx.llm.registerAdapter(['base', 'target'], adapter)
    const harness = await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(jevPlugin, { ...config, ...overrides, routes: [...(overrides.routes ?? config.routes)] })
    return { ctx, adapter, harness }
  }

  it('routes the step through the loop, records the route, and leaves the pending pick alone', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { ctx, adapter, harness } = await mountLoop([textResponse('ok')])
    const agent = await harness.create(SessionId('jev-loop'), { provider: 'base', model: 'base' })
    agent.model.select({ provider: 'base', model: 'picked' })
    agent.followup(input)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]).toMatchObject(routed)
    expect(agent.model.current()).toEqual({ provider: 'base', model: 'picked' })
    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'model/selection').map(event => event.data)).toEqual([{ provider: 'base', model: 'picked' }])
    expect(ctx.sessionProjections.snapshot(agent.session).values.modelSelection).toEqual({
      lastUsed: routed,
      lastUsedSeq: events.filter(event => event.type === 'request/header').at(-1)?.seq,
      next: { provider: 'base', model: 'picked' },
    })
    expect(events.filter(event => event.type === 'jev/decision').map(event => event.data)).toEqual([
      { turn: 1, step: 1, choice: 'small', confidence: 1, route: 'small', provider: 'target', model: 'small' },
    ])
  })

  it('returns a kept step to the configured model rather than the route the previous request recorded', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } }, { answers: { route: { choice: 'missing', confidence: 1 } } })
    const { adapter, harness } = await mountLoop([textResponse('one'), textResponse('two')])
    const agent = await harness.create(SessionId('jev-kept'), { provider: 'base', model: 'base' })
    agent.followup(input)
    await agent.whenIdle()
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'again' }] }))
    await agent.whenIdle()
    expect(adapter.requests.map(request => [request.provider, request.model])).toEqual([
      ['target', 'small'],
      ['base', 'base'],
    ])
  })

  it('stops the turn before any model request when Jev fails and failOpen is false', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.reject(new Error('offline'))))
    const { adapter, harness } = await mountLoop([textResponse('ok')], { failOpen: false })
    const agent = await harness.create(SessionId('jev-closed'), { provider: 'base', model: 'base' })
    agent.followup(input)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end')).toMatchObject([
      { data: { reason: { kind: 'blocked' } } },
    ])
  })
})

describe('Jev delegation guard', () => {
  it('leaves a child whose descriptor pins its route on that route', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { ctx, agent, preStep, route } = await mountWithProjections()
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    agent.session.append('subagent/descriptor', snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'target', routePinned: true }))
    expect(await route()).toBeUndefined()
    expect((await preStep()).kind).toBe('enter')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('leaves the root unrouted when its orchestrator role is fixed', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { route } = await mountWithProjections(fixedOrchestrator('small'))
    expect(await route()).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('still routes a delegated child whose root fixes the orchestrator', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const root = Session.create(SessionId('jev-root'))
    const { ctx, agent, route } = await mountWithProjections(fixedOrchestrator('pinned'))
    ctx.provide('sessions', { get: () => root } as never)
    Object.assign(agent, {
      session: Session.create(SessionId('jev-child'), undefined, {
        version: SESSION_FORMAT_VERSION, id: SessionId('jev-child'), createdAt: 1, isSeeded: false, cwd: '/workspace',
        origin: 'subagent', parentSession: root.id,
      }),
    })
    expect(await route()).toEqual(routed)
  })

  it('still routes a child and a root whose roles are Jev-decides', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const jevDecides = { enabled: true, reviewRounds: 0, roles: { orchestrator: { mode: 'jev' } } }
    const { ctx, agent, route } = await mountWithProjections(jevDecides)
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    agent.session.append('subagent/descriptor', snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'target' }))
    expect(await route()).toEqual(routed)
  })

  it.each([
    ['pins', { routePinned: true }, undefined],
    ['does not pin', {}, routed],
  ] as const)('reads a descriptor appended before the first routed step and %s the child route', async (_label, pin, expected) => {
    const fetchImpl = answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { ctx, agent, route } = await mount()
    await ctx.plugin(SessionProjectionRegistry)
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    agent.session.append('subagent/descriptor', snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'target', ...pin }))
    expect(await route()).toEqual(expected)
    expect(fetchImpl).toHaveBeenCalledTimes('routePinned' in pin ? 0 : 1)
  })
})

describe('Jev HTTP validation and cancellation', () => {
  it.each([null, {}, { answers: {} }, { answers: { route: { choice: 3, confidence: 1 } } },
    { answers: { route: { choice: 'small', confidence: 'high' } } },
    { answers: { route: { choice: 'small', confidence: -1 } } },
    { answers: { route: { choice: 'small', confidence: 2 } } },
  ])('refuses malformed route responses %j', async (value) => {
    const client = createJevClient(async () => 'fixture-key', answer(value))
    await expect(client.decide([input], config, signal)).rejects.toThrow('Jev')
  })

  it.each([null, {}, { answers: {} }, { answers: { match_0: { noul: 'high' } } },
    { answers: { match_0: { noul: -1 } } }, { answers: { match_0: { noul: 2 } } },
  ])('refuses malformed relevance scores %j', async (value) => {
    const client = createJevClient(async () => 'fixture-key', answer(value))
    await expect(client.scoreGrep('task', 'pattern', [{ path: 'a', lineNumber: 1, line: 'a' }], config, signal))
      .rejects.toThrow('Jev')
  })

  it('refuses a missing credential before making an HTTP request', async () => {
    const fetchImpl = answer({})
    const client = createJevClient(async () => undefined, fetchImpl)
    await expect(client.decide([], config, signal)).rejects.toThrow('no credential')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('propagates an existing abort, a later abort and the configured deadline', async () => {
    vi.useFakeTimers()
    for (const mode of ['already', 'later', 'deadline']) {
      const controller = new AbortController()
      if (mode === 'already') controller.abort()
      const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
        const requestSignal = init!.signal!
        if (requestSignal.aborted) throw new Error('aborted')
        return new Promise<Response>((_resolve, reject) => {
          requestSignal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        })
      })
      const client = createJevClient(async () => 'fixture-key', fetchImpl)
      const assertion = expect(client.decide([], config, controller.signal)).rejects.toThrow('aborted')
      await Promise.resolve()
      if (mode === 'later') controller.abort()
      if (mode === 'deadline') await vi.advanceTimersByTimeAsync(config.timeoutMs)
      await assertion
      expect(vi.getTimerCount()).toBe(0)
    }
  })
})

describe('Jev grep behavior', () => {
  it('keeps normal output unless a task state and enough candidates can be scored', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const agent = { session: Session.create(SessionId('jev-grep')) } as Agent
    const states = new WeakMap<Agent, string>()
    let active: Config = { ...config }
    const scoreGrep = vi.fn<JevClient['scoreGrep']>(async () => Array.from({ length: 250 }, (_v, index) => index / 250))
    const router = new JevRouter(ctx, () => active, { decide: vi.fn(), scoreGrep }, states)
    const matches = Array.from({ length: 300 }, (_v, index) => ({ path: 'a', lineNumber: index + 1, line: 'match' }))
    const args = { agent, pattern: 'match', matches, signal }
    expect(await router.filterGrepMatches(args)).toBe(matches)
    states.set(agent, 'task')
    active = { ...config, enabled: false }
    expect(await router.filterGrepMatches(args)).toBe(matches)
    active = { ...config }
    expect(await router.filterGrepMatches({ ...args, signal: AbortSignal.abort() })).toBe(matches)
    const few = matches.slice(0, 99)
    expect(await router.filterGrepMatches({ ...args, matches: few })).toBe(few)
    expect(await router.filterGrepMatches(args)).toEqual(matches.slice(218, 250))
    expect(scoreGrep.mock.calls[0]?.[2]).toHaveLength(250)
    scoreGrep.mockRejectedValueOnce(new Error('offline'))
    expect(await router.filterGrepMatches(args)).toBe(matches)
  })

  it('rejects unaligned scores and invalid retention counts; preserves ties and short output', () => {
    const matches = [{ path: 'a', lineNumber: 1, line: 'a' }, { path: 'b', lineNumber: 2, line: 'b' }]
    expect(() => selectRelevantGrepMatches(matches, [], 1)).toThrow('candidate count')
    expect(() => selectRelevantGrepMatches(matches, [1, 1], 0)).toThrow('positive integer')
    expect(selectRelevantGrepMatches(matches, [1, 1])).toEqual(matches)
    expect(selectRelevantGrepMatches(matches, [1, 1], 1)).toEqual([matches[0]])
  })

  it('projects every content kind and keeps oversized metadata within the state budget', () => {
    const content = [
      { type: 'reasoning' as const, text: 'think' },
      { type: 'tool-call' as const, id: ToolCallId('call'), name: 'read', arguments: '{}' },
      { type: 'image' as const, attachment: {} as import('@deepseek-ai/dsh-llm').ImageBlock['attachment'] },
      { type: 'file' as const, attachment: {} as import('@deepseek-ai/dsh-llm').FileBlock['attachment'] },
      { type: 'tool-removal' as const, toolName: 'read' },
    ]
    expect(stateForMessages([{ ...input, content }], 1000)).toContain('[content block]')
    expect(stateForMessages([{ ...input, content }], 1000)).toContain('[reasoning: think]')
    expect(stateForMessages(Array.from({ length: 30 }, () => input), 20)).toBe('{"messages":[]}')
  })
})
