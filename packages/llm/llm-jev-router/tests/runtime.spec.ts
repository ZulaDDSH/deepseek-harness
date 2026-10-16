import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type LlmCallConfig, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { JevRouter, apply, createJevClient, selectRelevantGrepMatches, stateForMessages, type Config, type JevClient, type RuntimeConfig } from '../src/index.ts'
import * as jevPlugin from '../src/index.ts'
import { createVolatile, updateVolatile } from '../../../../vendor/cosmokit/src/volatile.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime, { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'

const config = {
  enabled: true, apiKeyEnv: 'JEV_TEST_KEY', endpoint: 'https://jev.example.test/v1', model: 'jev-test',
  timeoutMs: 1000, minConfidence: 0.8, stateMaxChars: 1000, fallback: 'keep', failOpen: true,
  routes: [{ id: 'small', provider: 'target', model: 'small', description: 'Routine work' }],
} satisfies Config
const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'fix routing' }] })
const base: LlmCallConfig = { provider: 'base', model: 'base' }
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
    'agent/pre-step', { turn, step, messages: [input], signal: currentSignal },
    () => Promise.resolve(kind === 'enter' ? { kind, messages: [input] } : { kind }),
  )
  const request = (step = 1, currentSignal = signal, seed: LlmCallConfig = base, turn = 1) => events.waterfall(
    'agent/request', { turn, step, signal: currentSignal }, () => Promise.resolve(seed),
  )
  return { ctx, fiber, agent, preStep, request }
}

function answer(value: unknown) {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(value))
  vi.stubGlobal('fetch', fetchImpl)
  return fetchImpl
}

describe('Jev routing lifecycle', () => {
  it('decides once per turn, reuses it for every step, and releases its provider and listeners', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { ctx, fiber, preStep, request } = await mount()
    expect(ctx.get('llm')!.listConfigurableProviders()).toMatchObject([{ provider: 'jev-router' }])
    expect(await request()).toBe(base)
    expect(await preStep()).toEqual({ kind: 'enter', messages: [input] })
    expect(await request()).toEqual({ provider: 'target', model: 'small' })
    expect(await request(1, AbortSignal.abort())).toBe(base)
    await preStep(2)
    expect(await request(2)).toEqual({ provider: 'target', model: 'small' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(await request(1, signal, base, 2)).toBe(base)
    await preStep(1, signal, 'enter', 2)
    expect(await request(1, signal, base, 2)).toEqual({ provider: 'target', model: 'small' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await fiber.dispose()
    expect(ctx.get('llm')!.listConfigurableProviders()).toEqual([])
    expect(await request()).toBe(base)
  })

  it('wins over a per-Session model selection installed after the plugin', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { ctx, preStep, request } = await mount()
    ctx.on('agent/request', async (_payload, next) => ({ ...await next(), provider: 'picked', model: 'picked' }), { prepend: true })
    expect(await request()).toEqual({ provider: 'picked', model: 'picked' })
    await preStep()
    expect(await request()).toEqual({ provider: 'target', model: 'small' })
    expect(await request(1, signal, base, 2)).toEqual({ provider: 'picked', model: 'picked' })
  })

  it('returns an unrouted step to the configured model instead of the previous route', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { agent, preStep, request } = await mount()
    const previous = { provider: 'target', model: 'small' }
    expect(await request(1, signal, previous, 2)).toBe(previous)
    Object.assign(agent.options, { provider: 'base', model: 'base', reasoningEffort: 'high' })
    await preStep()
    expect(await request()).toEqual({ provider: 'target', model: 'small' })
    expect(await request(1, signal, previous, 2)).toEqual({ provider: 'base', model: 'base', reasoningEffort: 'high' })
    expect(await request(1, signal, base, 2)).toBe(base)
  })

  it('delegates disabled, rejected, aborted, empty-route and keep decisions', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'missing', confidence: 1 } } })
    for (const overrides of [{ enabled: false }, { routes: [] }, {}]) {
      const { preStep, request } = await mount(overrides)
      expect(await preStep(1, signal, 'reject')).toEqual({ kind: 'reject' })
      expect(await preStep(1, AbortSignal.abort())).toEqual({ kind: 'enter', messages: [input] })
      expect(await preStep()).toEqual({ kind: 'enter', messages: [input] })
      expect(await request()).toBe(base)
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('delegates a later request unchanged after the live config disables routing', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { fiber, preStep, request } = await mount()
    await preStep()
    expect(await request()).toEqual({ provider: 'target', model: 'small' })
    updateVolatile(fiber.config as RuntimeConfig, createVolatile({ ...config, routes: [...config.routes], enabled: false }))
    expect(await request()).toBe(base)
  })

  it('releases a disposed Agent and stops routing its requests', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { ctx, agent, preStep, request } = await mount()
    ctx.emit('agent/disposed', { agent })
    await preStep()
    expect(await request()).toEqual({ provider: 'target', model: 'small' })
    ctx.emit('agent/disposed', { agent })
    expect(await request()).toBe(base)
  })

  it('preserves or rejects the admitted input according to failure policy', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('offline') }))
    for (const failOpen of [true, false]) {
      const { preStep, request } = await mount({ failOpen })
      expect((await preStep()).kind).toBe(failOpen ? 'enter' : 'reject')
      expect(await request()).toBe(base)
    }
  })

  it('does not retry a failed decision on later steps of the same turn', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetchImpl)
    const { preStep, request } = await mount()
    expect((await preStep()).kind).toBe('enter')
    expect((await preStep(2)).kind).toBe('enter')
    expect(await request(2)).toBe(base)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await preStep(1, signal, 'enter', 2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{ choice: 'small', confidence: 0.9 }, {}, { route: 'small', provider: 'target', model: 'small' }],
    [{ choice: 'small', confidence: 0.01 }, { fallback: 'safe' }, { route: 'safe', provider: 'target', model: 'safe' }],
    [{ choice: 'small', confidence: 0.01 }, {}, {}],
  ])('records Jev\'s pick %o and the route actually applied', async (pick, overrides, applied) => {
    answer({ answers: { route: pick } })
    const routes = [...config.routes, { id: 'safe', provider: 'target', model: 'safe', description: 'Fallback' }]
    const { agent, preStep } = await mount({ ...overrides, routes })
    await preStep()
    expect(agent.session.snapshotEvents().filter(event => event.type === 'jev/decision').map(event => event.data))
      .toEqual([{ turn: 1, step: 1, ...pick, ...applied }])
  })

  it('never offers or applies a route on an unregistered provider', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'ghost', confidence: 1 } } })
    const routes = [...config.routes, { id: 'ghost', provider: 'ghost', model: 'ghost', description: 'Unregistered' }]
    const { agent, preStep, request } = await mount({ routes })
    await preStep()
    expect(await request()).toBe(base)
    const [, init] = fetchImpl.mock.calls[0]!
    const sent = JSON.parse(init?.body as string) as { questions: { route: { criteria: unknown } } }
    expect(sent.questions.route.criteria).toEqual({ small: 'Routine work' })
    expect(agent.session.snapshotEvents().filter(event => event.type === 'jev/decision').map(event => event.data))
      .toEqual([{ turn: 1, step: 1, choice: 'ghost', confidence: 1, unroutable: true }])
  })

  it('skips Jev when no configured route is registered', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'ghost', confidence: 1 } } })
    const { preStep, request } = await mount({ routes: [{ id: 'ghost', provider: 'ghost', model: 'g', description: 'x' }] })
    await preStep()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await request()).toBe(base)
  })

  it('records a decision failure as a jev/decision event', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.reject(new Error('offline'))))
    const thrown = await mount()
    await thrown.preStep()
    expect(thrown.agent.session.snapshotEvents().filter(event => event.type === 'jev/decision').map(event => event.data))
      .toEqual([{ turn: 1, step: 1, error: expect.stringContaining('offline') as string, rejected: false }])
  })

  it('records a stopped turn when the router fails closed', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.reject(new Error('offline'))))
    const stopped = await mount({ failOpen: false })
    expect(await stopped.preStep()).toEqual({ kind: 'reject' })
    expect(stopped.agent.session.snapshotEvents().filter(event => event.type === 'jev/decision').map(event => event.data))
      .toEqual([{ turn: 1, step: 1, error: expect.stringContaining('offline') as string, rejected: true }])
  })

  it('falls back to the Agent route only when it names both provider and model', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { agent, preStep, request } = await mount()
    Object.assign(agent.options, { provider: 'base' })
    await preStep()
    const previous = { provider: 'target', model: 'small' }
    expect(await request(1, signal, previous, 2)).toBe(previous)
    Object.assign(agent.options, { model: 'base' })
    expect(await request(1, signal, previous, 2)).toEqual({ provider: 'base', model: 'base' })
  })

  it('returns an unrouted step to the Session model selection when one is stored', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { ctx, preStep, request } = await mount()
    ctx.provide('sessionProjections', { stateOf: () => ({ selected: { provider: 'chosen', model: 'pick' } }) } as never)
    await preStep()
    const previous = { provider: 'target', model: 'small' }
    expect(await request(1, signal, previous, 2)).toEqual({ provider: 'chosen', model: 'pick' })
  })

  it('returns an unrouted step to the fixed orchestrator route rather than the Session selection', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { ctx, preStep, request } = await mount()
    let fixed = false
    const orchestrator = { mode: 'fixed', route: { backend: 'llm', provider: 'target', model: 'pinned' } }
    ctx.provide('sessionProjections', {
      stateOf: (_session: Session, key: string) => key === 'runOptions' && fixed
        ? { current: { subagentSetup: { enabled: true, reviewRounds: 0, roles: { orchestrator } } } }
        : { selected: { provider: 'chosen', model: 'pick' } },
    } as never)
    await preStep()
    fixed = true
    await preStep(1, signal, 'enter', 2)
    expect(await request(1, signal, { provider: 'target', model: 'pinned' }, 2)).toEqual({ provider: 'target', model: 'pinned' })
  })

  it('uses the credential provider rather than falling back to the environment', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const resolved = await mount({}, { JEV_TEST_KEY: 'provider-fixture-key' })
    await resolved.preStep()
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer provider-fixture-key')
    const missing = await mount({}, {})
    await missing.preStep()
    expect(await missing.request()).toBe(base)
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

describe('Jev delegation guard', () => {
  async function mountWithProjections(stateOf: (session: Session, key: string) => unknown) {
    const mounted = await mount()
    await mounted.ctx.plugin(SessionProjectionRegistry)
    const readOriginal = mounted.ctx.sessionProjections.stateOf.bind(mounted.ctx.sessionProjections)
    vi.spyOn(mounted.ctx.sessionProjections, 'stateOf').mockImplementation((session, key) =>
      stateOf(session, key) ?? readOriginal(session, key))
    return mounted
  }

  it('leaves a child whose descriptor pins its route on that route', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { preStep, request } = await mountWithProjections((_session, key) =>
      key === 'subagent' ? { identity: { mode: 'one-shot', routePinned: true } } : undefined)
    expect(await preStep()).toEqual({ kind: 'enter', messages: [input] })
    expect(await request()).toBe(base)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('leaves the root unrouted when its orchestrator role is fixed', async () => {
    const fetchImpl = answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { preStep, request } = await mountWithProjections((_session, key) => key === 'runOptions'
      ? { current: { subagentSetup: { enabled: true, reviewRounds: 0, roles: { orchestrator: { mode: 'fixed', route: { backend: 'llm', provider: 'target', model: 'small' } } } } } }
      : undefined)
    await preStep()
    expect(await request()).toBe(base)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('still routes a delegated child whose root fixes the orchestrator', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const root = Session.create(SessionId('jev-root'))
    const { ctx, agent, preStep, request } = await mountWithProjections((session, key) => session === root && key === 'runOptions'
      ? { current: { subagentSetup: { enabled: true, reviewRounds: 0, roles: { orchestrator: { mode: 'fixed', route: { backend: 'llm', provider: 'target', model: 'pinned' } } } } } }
      : undefined)
    ctx.provide('sessions', { get: () => root } as never)
    Object.assign(agent, {
      session: Session.create(SessionId('jev-child'), undefined, {
        version: SESSION_FORMAT_VERSION, id: SessionId('jev-child'), createdAt: 1, isSeeded: false, cwd: '/workspace',
        origin: 'subagent', parentSession: root.id,
      }),
    })
    await preStep()
    expect(await request()).toEqual({ provider: 'target', model: 'small' })
  })

  it('still routes a child and a root whose roles are Jev-decides', async () => {
    answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { preStep, request } = await mountWithProjections((_session, key) => key === 'subagent'
      ? { identity: { mode: 'one-shot' } }
      : key === 'runOptions' ? { current: { subagentSetup: { enabled: true, reviewRounds: 0, roles: { orchestrator: { mode: 'jev' } } } } } : undefined)
    await preStep()
    expect(await request()).toEqual({ provider: 'target', model: 'small' })
  })

  it.each([
    ['pins', { routePinned: true }, base],
    ['does not pin', {}, { provider: 'target', model: 'small' }],
  ] as const)('reads the descriptor appended after the Jev step and %s the child route', async (_label, pin, expected) => {
    const fetchImpl = answer({ answers: { route: { choice: 'small', confidence: 1 } } })
    const { ctx, preStep, request } = await mount()
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SubagentRuntime)
    let appended = false
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (!appended && decision.kind === 'enter') {
        appended = true
        payload.agent.session.append('subagent/descriptor', snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'target', ...pin }))
      }
      return decision
    })
    expect(await preStep()).toEqual({ kind: 'enter', messages: [input] })
    expect(await request()).toEqual(expected)
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
