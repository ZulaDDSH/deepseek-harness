import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { Context, Service } from '@deepseek-ai/cordis'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'

async function startAs(ctx: Context, provider: string, { signal, ...request }: SubagentStartRequest) {
  if (ctx.agents.get(request.parent.id) !== request.parent) await ctx.agents.register(request.parent)
  return ctx.subagents.startActivation({ provider, label: 'provider task', request, signal, delivery: 'caller' })
}
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'
import * as claudeCode from '../src/index.ts'

const queryMock = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/claude-agent-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>(),
  query: queryMock,
}))

const BASE_URL = process.env.ANTHROPIC_BASE_URL
const envs: Record<string, string | undefined>[] = []

class FakeLlm extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  listConfigurableProviders() {
    return [{
      provider: 'anthropic',
      displayName: 'Anthropic',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'anthropic'],
    }]
  }
}

class FakeSettings extends Service {
  constructor(ctx: Context, private readonly profile: Record<string, string>) {
    super(ctx, 'settings')
  }

  describe() {
    return [{ ns: 'llm-pi-ai', value: { providers: { anthropic: this.profile } } }]
  }
}

interface Stored {
  profile?: Record<string, string>
  credentials?: Record<string, string>
  env?: Record<string, string>
  record?: CredentialRecord
}

const fakeParent = {
  id: 'parent',
  session: {
    id: 'parent',
    header: { cwd: process.cwd() },
    requestHeader: () => undefined,
    inheritedEventCount: SessionLogOffset(0),
    seq: SessionLogOffset(0),
    snapshotEvents: (): readonly SessionEvent[] => [],
  },
} as Agent

async function bootWith(stored: Stored): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  const credentials = new MemoryCredentials(ctx, stored.credentials ?? {})
  if (stored.record !== undefined) {
    const record = stored.record
    await credentials.modifyRecord(credentialKey('llm-pi-ai', 'anthropic'), () => Promise.resolve(record))
  }
  new FakeLlm(ctx)
  new FakeSettings(ctx, stored.profile ?? {})
  await ctx.plugin(claudeCode, { env: stored.env ?? {} })
  return ctx
}

function startRun(ctx: Context): Promise<unknown> {
  return startAs(ctx, 'claude-code', {
    prompt: [{ type: 'text', text: 'do the task' }],
    parent: fakeParent,
    signal: new AbortController().signal,
  })
}

beforeEach(() => {
  envs.length = 0
  delete process.env.ANTHROPIC_BASE_URL
  queryMock.mockImplementation(({ options }: { options: Options }) => {
    envs.push(options.env ?? {})
    throw new Error('query captured for the environment assertion')
  })
})

afterEach(() => {
  queryMock.mockReset()
  vi.restoreAllMocks()
  if (BASE_URL !== undefined) process.env.ANTHROPIC_BASE_URL = BASE_URL
})

describe('the Anthropic route key in a Claude Code run', () => {
  it('starts the run with the stored key the route names', async () => {
    const key = ['fake', 'anthropic', 'key'].join('-')
    const ctx = await bootWith({
      profile: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      credentials: { ANTHROPIC_API_KEY: key },
    })

    await expect(startRun(ctx)).rejects.toThrow()
    expect(envs).toHaveLength(1)
    expect(envs[0]?.ANTHROPIC_API_KEY).toBe(key)
    await ctx.fiber.dispose()
  })

  it('carries a role run model and effort, with the route key, when billing is switched', async () => {
    const key = ['fake', 'anthropic', 'key'].join('-')
    const ctx = await bootWith({
      profile: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      credentials: { ANTHROPIC_API_KEY: key },
    })
    expect(ctx.subagents.getProvider('claude-code')?.capabilities.agentOptions).toBe(true)
    const seen: Options[] = []
    queryMock.mockImplementation(({ options }: { options: Options }) => {
      seen.push(options)
      throw new Error('query captured for the run assertion')
    })

    await expect(startAs(ctx, 'claude-code', {
      prompt: [{ type: 'text', text: 'do the task' }],
      parent: fakeParent,
      signal: new AbortController().signal,
      agentOptions: { model: 'opus', reasoningEffort: ReasoningEffortId('high') },
    })).rejects.toThrow()
    expect(seen).toHaveLength(1)
    expect(seen[0]?.model).toBe('opus')
    expect(seen[0]?.effort).toBe('high')
    expect(seen[0]?.env?.ANTHROPIC_API_KEY).toBe(key)
    await ctx.fiber.dispose()
  })

  it('leaves the run on the sign-in when the route names no key', async () => {
    const ctx = await bootWith({ profile: {} })

    await expect(startRun(ctx)).rejects.toThrow()
    expect(envs).toHaveLength(1)
    expect(envs[0]).not.toHaveProperty('ANTHROPIC_API_KEY')
    await ctx.fiber.dispose()
  })

  it('passes the API key saved through sign-in when the route names no reference', async () => {
    const key = ['fake', 'signin', 'key'].join('-')
    const ctx = await bootWith({ profile: {}, record: { kind: 'api-key', key } })

    await expect(startRun(ctx)).rejects.toThrow()
    expect(envs).toHaveLength(1)
    expect(envs[0]?.ANTHROPIC_API_KEY).toBe(key)
    await ctx.fiber.dispose()
  })

  it('does not pass a subscription sign-in grant as the key', async () => {
    const ctx = await bootWith({ profile: {}, record: { kind: 'grant', payload: { access: ['fake', 'grant'].join('-') } } })

    await expect(startRun(ctx)).rejects.toThrow()
    expect(envs).toHaveLength(1)
    expect(envs[0]).not.toHaveProperty('ANTHROPIC_API_KEY')
    await ctx.fiber.dispose()
  })

  it('refuses to start when the named reference resolves to no credential', async () => {
    const ctx = await bootWith({ profile: { apiKeyEnv: 'ANTHROPIC_API_KEY' } })

    await expect(startRun(ctx)).rejects.toThrow('ANTHROPIC_API_KEY resolves to no credential')
    expect(queryMock).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('keeps a key the deployment sets explicitly over the stored key', async () => {
    const explicit = ['deployment', 'fake', 'key'].join('-')
    const ctx = await bootWith({
      profile: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      credentials: { ANTHROPIC_API_KEY: ['stored', 'fake', 'key'].join('-') },
      env: { ANTHROPIC_API_KEY: explicit },
    })

    await expect(startRun(ctx)).rejects.toThrow()
    expect(envs[0]?.ANTHROPIC_API_KEY).toBe(explicit)
    await ctx.fiber.dispose()
  })

  it('does not send the stored key to a custom base URL', async () => {
    const ctx = await bootWith({
      profile: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      credentials: { ANTHROPIC_API_KEY: ['stored', 'fake', 'key'].join('-') },
      env: { ANTHROPIC_BASE_URL: 'https://gateway.example.test' },
    })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    await expect(startRun(ctx)).rejects.toThrow()
    expect(envs[0]).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(warn).toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
