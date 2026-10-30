import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import type { SessionRunOptions } from '@deepseek-ai/dsh-api-session-controller'
import { type Session, type SessionEvent, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'

async function startAs(ctx: Context, provider: string, { signal, ...request }: SubagentStartRequest) {
  if (ctx.agents.get(request.parent.id) !== request.parent) await ctx.agents.register(request.parent)
  return ctx.subagents.startActivation({ provider, label: 'provider task', request, signal, delivery: 'caller' })
}
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as claudeCode from '../src/index.ts'
import { inheritedRunOptions } from '../src/run-options-projection.ts'
import type { ClaudeCodePermissionMode } from '../src/run.ts'
import { fakeChild, sdkSpawnOptions, success } from './claude-fakes.ts'
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'

type QueryFactory = (params: {
  prompt: string
  options: Options
}) => Query

type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

const queryMock = vi.hoisted(() => vi.fn<QueryFactory>())

vi.mock('@anthropic-ai/claude-agent-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>(),
  query: queryMock,
}))

/** Minimal Session face the runOptions projection fold reads. */
function fakeSession(header: { readonly parentSession?: string | undefined } = {}): Session {
  return {
    id: 'parent',
    header: { cwd: process.cwd(), ...header },
    requestHeader: () => undefined,
    inheritedEventCount: SessionLogOffset(0),
    seq: SessionLogOffset(0),
    snapshotEvents: (): readonly SessionEvent[] => [],
  } as never
}

const parentAgent: Agent = {
  id: 'parent',
  session: fakeSession(),
} as never

function resultQuery(messages: readonly SDKMessage[]): Query {
  async function* stream(): AsyncGenerator<SDKMessage, void> {
    for (const message of messages) yield message
  }
  return Object.assign(stream(), { close: vi.fn() }) as never
}

afterEach(() => {
  queryMock.mockReset()
})

async function runClaudeCode(
  permissionMode: ClaudeCodePermissionMode,
  sandbox: SandboxMode | undefined,
  messages: readonly SDKMessage[] = [success('answer')],
  agentMode: ClaudeCodePermissionMode = 'bypassPermissions',
) {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  if (sandbox !== undefined) {
    ctx.provide('sandboxPolicy', {
      resolve: () => ({ mode: sandbox, workspaceRoot: process.cwd() }),
    } as never)
  }
  const child = fakeChild()
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(() => child.handle)
  const captured: { options?: Options } = {}
  queryMock.mockImplementation(({ options }) => {
    captured.options = options
    options.spawnClaudeCodeProcess!(sdkSpawnOptions())
    return resultQuery(messages)
  })
  await ctx.plugin(claudeCode, {
    permissionMode,
    agents: {
      helper: { description: 'Helps', prompt: 'Help.', permissionMode: agentMode },
    },
  })
  const run = await startAs(ctx, 'claude-code', {
    prompt: [{ type: 'text', text: 'do the task' }],
    parent: parentAgent,
    signal: new AbortController().signal,
  })
  const settled = await run.result
  await run.dispose()
  await ctx.fiber.dispose()
  return { options: captured.options, settled }
}

describe('parent sandbox clamp', () => {
  const cases: readonly {
    readonly name: string
    readonly sandbox: SandboxMode | undefined
    readonly configured: ClaudeCodePermissionMode
    readonly expected: ClaudeCodePermissionMode
    readonly agent: ClaudeCodePermissionMode
  }[] = [
    { name: 'no sandbox policy composed', sandbox: undefined, configured: 'bypassPermissions', expected: 'bypassPermissions', agent: 'bypassPermissions' },
    { name: 'danger-full-access keeps bypass', sandbox: 'danger-full-access', configured: 'bypassPermissions', expected: 'bypassPermissions', agent: 'bypassPermissions' },
    { name: 'workspace-write downgrades bypass', sandbox: 'workspace-write', configured: 'bypassPermissions', expected: 'acceptEdits', agent: 'acceptEdits' },
    { name: 'workspace-write downgrades auto', sandbox: 'workspace-write', configured: 'auto', expected: 'acceptEdits', agent: 'acceptEdits' },
    { name: 'workspace-write keeps dontAsk', sandbox: 'workspace-write', configured: 'dontAsk', expected: 'dontAsk', agent: 'acceptEdits' },
    { name: 'read-only plans over bypass', sandbox: 'read-only', configured: 'bypassPermissions', expected: 'plan', agent: 'plan' },
    { name: 'read-only plans over dontAsk', sandbox: 'read-only', configured: 'dontAsk', expected: 'plan', agent: 'plan' },
  ]

  it.each(cases)('$name', async ({ sandbox, configured, expected, agent }) => {
    const { options, settled } = await runClaudeCode(configured, sandbox)

    expect(settled).toMatchObject({ stopReason: 'completed' })
    expect(options?.permissionMode).toBe(expected)
    if (expected === 'bypassPermissions') {
      expect(options?.allowDangerouslySkipPermissions).toBe(true)
    } else {
      expect(options).not.toHaveProperty('allowDangerouslySkipPermissions')
    }
    expect(options?.agents?.helper?.permissionMode).toBe(agent)
  })

  it('downgrades a Profile agent auto mode under workspace-write', async () => {
    const { options, settled } = await runClaudeCode(
      'dontAsk',
      'workspace-write',
      [success('answer')],
      'auto',
    )

    expect(settled).toMatchObject({ stopReason: 'completed' })
    expect(options?.permissionMode).toBe('dontAsk')
    expect(options?.agents?.helper?.permissionMode).toBe('acceptEdits')
  })

  it('records the narrowing in the failure diagnostic under read-only', async () => {
    const { settled } = await runClaudeCode('bypassPermissions', 'read-only', [
      { type: 'system', subtype: 'init' } as SDKMessage,
    ])

    expect(settled.stopReason).toBe('error')
    expect(settled.diagnostic).toContain('narrowed from bypassPermissions to plan')
  })

  it('records an agent-only narrowing in the failure diagnostic', async () => {
    const { settled, options } = await runClaudeCode('dontAsk', 'workspace-write', [
      { type: 'system', subtype: 'init' } as SDKMessage,
    ])

    expect(options?.permissionMode).toBe('dontAsk')
    expect(options?.agents?.helper?.permissionMode).toBe('acceptEdits')
    expect(settled.stopReason).toBe('error')
    expect(settled.diagnostic).toContain('agent helper permission mode narrowed from bypassPermissions to acceptEdits')
  })
})

describe('inherited Session run options', () => {
  function chain(length: number) {
    const sessions = Array.from({ length }, (_, index) => fakeSession({
      parentSession: index + 1 < length ? `s${index + 1}` : undefined,
    }))
    const byId = new Map(sessions.map((session, index) => [`s${index}`, session]))
    return { sessions, byId }
  }

  it('returns the parent options when the child has none', () => {
    const parent = fakeSession({})
    const child = fakeSession({ parentSession: 'p' })
    const runOptions = new Map<Session, SessionRunOptions | null>([[parent, { ultracode: true }], [child, null]])
    const byId = new Map([['p', parent]])

    expect(inheritedRunOptions(child, session => runOptions.get(session), id => byId.get(id)))
      .toEqual({ ultracode: true })
  })

  it('prefers the child own options over its parent', () => {
    const parent = fakeSession({})
    const child = fakeSession({ parentSession: 'p' })
    const runOptions = new Map<Session, SessionRunOptions | null>([[parent, { ultracode: true }], [child, { effort: 'high' }]])
    const byId = new Map([['p', parent]])

    expect(inheritedRunOptions(child, session => runOptions.get(session), id => byId.get(id)))
      .toEqual({ effort: 'high' })
  })

  it('reads at most eight parent hops', () => {
    const { sessions, byId } = chain(10)
    const first = sessions[0]!
    const reachable = new Map<Session, SessionRunOptions | null>([[sessions[8]!, { ultracode: true }]])
    const beyond = new Map<Session, SessionRunOptions | null>([[sessions[9]!, { ultracode: true }]])

    expect(inheritedRunOptions(first, session => reachable.get(session), id => byId.get(id)))
      .toEqual({ ultracode: true })
    expect(inheritedRunOptions(first, session => beyond.get(session), id => byId.get(id)))
      .toBeUndefined()
  })

  it('returns undefined when the parent Session cannot be resolved', () => {
    const child = fakeSession({ parentSession: 'missing' })

    expect(inheritedRunOptions(child, () => null, () => undefined)).toBeUndefined()
  })
})

describe('inherited run options through the provider', () => {
  it('projects ultracode from an ancestor Session into the SDK settings', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    const rootSession = fakeSession({})
    const parentSession = fakeSession({ parentSession: 'root' })
    ctx.provide('sessions', {
      get: (id: string) => id === 'root' ? rootSession : undefined,
    } as never)
    const runOptionsOf = (session: Session) => session === rootSession
      ? { current: { ultracode: true } }
      : { current: null }
    vi.spyOn(ctx.sessionProjections, 'snapshot').mockImplementation(session => ({ values: { runOptions: runOptionsOf(session) } }) as never)
    const child = fakeChild()
    vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(() => child.handle)
    const captured: { options?: Options } = {}
    queryMock.mockImplementation(({ options }) => {
      captured.options = options
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      return resultQuery([success('answer')])
    })
    await ctx.plugin(claudeCode, { model: 'claude-opus-5-5' })

    const run = await startAs(ctx, 'claude-code', {
      prompt: [{ type: 'text', text: 'do the task' }],
      parent: { id: 'parent', options: { model: 'claude-opus-5-5' }, session: parentSession } as never,
      signal: new AbortController().signal,
    })
    await run.result
    await run.dispose()
    await ctx.fiber.dispose()

    expect(captured.options?.settings).toEqual({ ultracode: true, enableWorkflows: true })
  })
})
