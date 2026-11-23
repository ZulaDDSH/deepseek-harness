import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, type SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime, { type SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'
import * as freebuff from '../src/index.ts'
import type { Config } from '../src/index.ts'

const FAKE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-freebuff.mjs')
const TEST_TIMEOUT_MS = 30_000

const parentId = brandString<SessionId>('parent')
const fakeParent: Agent = {
  id: parentId,
  session: Session.create(parentId, undefined, {
    version: SESSION_FORMAT_VERSION,
    id: parentId,
    createdAt: 0,
    cwd: process.cwd(),
    isSeeded: false,
  }),
} as never

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function request(
  text = 'do the task',
  signal = new AbortController().signal,
): SubagentStartRequest {
  const prompt: ContentBlock[] = [{ type: 'text', text }]
  return { prompt, parent: fakeParent, signal }
}

async function startAs(ctx: Context, { signal, ...rest }: SubagentStartRequest) {
  if (ctx.agents.get(rest.parent.id) !== rest.parent) await ctx.agents.register(rest.parent)
  return ctx.subagents.startActivation({ provider: 'freebuff', label: 'provider task', ...rest, signal, delivery: 'caller' })
}

async function providerContext(
  mode: string,
  config: Partial<Config> = {},
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access',
) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  if (sandbox !== undefined) {
    ctx.provide('sandboxPolicy', { resolve: () => ({ mode: sandbox, workspaceRoot: process.cwd() }) } as never)
  }
  const configDir = mkdtempSync(join(tmpdir(), 'dsh-freebuff-'))
  roots.push(configDir)
  const spawnTerminal = vi.spyOn(ctx.subprocess, 'spawnTerminal')
  await ctx.plugin(freebuff, {
    executable: process.execPath,
    args: [FAKE],
    loginCheck: false,
    startupTimeoutMs: 15_000,
    idleMs: 300,
    timeoutMs: 20_000,
    disposeGraceMs: 500,
    ...config,
    env: { FAKE_FREEBUFF_MODE: mode, FREEBUFF_CONFIG_DIR: configDir, ...config.env },
  })
  return { ctx, spawnTerminal }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (_gone) {
    return false
  }
}

describe('Freebuff provider driving the TUI', () => {
  it('returns the answer read from the screen and releases the process', async () => {
    const { ctx, spawnTerminal } = await providerContext('ok')
    const run = await startAs(ctx, request('first line\nsecond line'))
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: expect.stringContaining('FAKE-ANSWER lines=2 esc=false trust=none args=') }],
      stopReason: 'completed',
    })
    const handle = await spawnTerminal.mock.results[0]!.value as { pid: number }
    await run.dispose()
    expect(isAlive(handle.pid)).toBe(false)
  }, TEST_TIMEOUT_MS)

  it('prefers the persisted transcript for the answer', async () => {
    const { ctx } = await providerContext('ok', { env: { FAKE_FREEBUFF_TRANSCRIPT: '1' } })
    const run = await startAs(ctx, request())
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'TRANSCRIPT-ANSWER' }],
      stopReason: 'completed',
    })
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('removes control characters from the pasted task', async () => {
    const { ctx } = await providerContext('ok')
    const run = await startAs(ctx, request('one\x1b[201~two\nthree'))
    const result = await run.result
    expect(result.output).toEqual([{ type: 'text', text: expect.stringContaining('lines=2 esc=false') }])
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('appends extra arguments and the trust flag after the configured arguments', async () => {
    const { ctx, spawnTerminal } = await providerContext('trust', { args: [FAKE, '--extra'], trustAgents: true })
    const run = await startAs(ctx, request())
    const result = await run.result
    expect(result.output).toEqual([{ type: 'text', text: expect.stringContaining('trust=flag args=--extra,--trust-agents') }])
    expect(spawnTerminal.mock.calls[0]![0].argv).toEqual([process.execPath, FAKE, '--extra', '--trust-agents'])
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('declines the project agents trust prompt by default', async () => {
    const { ctx } = await providerContext('trust')
    const run = await startAs(ctx, request())
    const result = await run.result
    expect(result.output).toEqual([{ type: 'text', text: expect.stringContaining('trust=n') }])
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('fails with the typed not-logged-in error when the login screen shows', async () => {
    const { ctx } = await providerContext('login')
    await expect(startAs(ctx, request())).rejects.toMatchObject({
      code: 'FREEBUFF_NOT_LOGGED_IN',
      message: expect.stringContaining('freebuff login'),
    })
  }, TEST_TIMEOUT_MS)

  it('never confirms an admission prompt', async () => {
    const { ctx } = await providerContext('blocked')
    await expect(startAs(ctx, request())).rejects.toMatchObject({
      code: 'FREEBUFF_RUN_FAILED',
      category: 'blocked',
    })
  }, TEST_TIMEOUT_MS)

  it('reports a Freebuff exit during startup', async () => {
    const { ctx } = await providerContext('exit')
    await expect(startAs(ctx, request())).rejects.toMatchObject({
      code: 'FREEBUFF_RUN_FAILED',
      stage: 'process',
    })
  }, TEST_TIMEOUT_MS)

  it('flattens a product error from the transcript into a safe diagnostic', async () => {
    const { ctx } = await providerContext('error', { env: { FAKE_FREEBUFF_TRANSCRIPT: '1' } })
    const run = await startAs(ctx, request())
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: product-error')
    expect(result.diagnostic).not.toContain('boom')
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('settles as an error with category limit when timeoutMs elapses', async () => {
    const { ctx } = await providerContext('hang', { timeoutMs: 1_500 })
    const run = await startAs(ctx, request())
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: limit')
    expect(result.diagnostic).toContain('exceeded timeoutMs (1500 ms)')
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('kills the process when the request is cancelled', async () => {
    const abort = new AbortController()
    const { ctx, spawnTerminal } = await providerContext('hang')
    const run = await startAs(ctx, request('do the task', abort.signal))
    const handle = await spawnTerminal.mock.results[0]!.value as { pid: number }
    expect(isAlive(handle.pid)).toBe(true)
    abort.abort()
    await expect(run.result).resolves.toMatchObject({ stopReason: 'aborted' })
    await run.dispose()
    expect(isAlive(handle.pid)).toBe(false)
  }, TEST_TIMEOUT_MS)

  it('fails with the typed not-installed error for a missing executable', async () => {
    const { ctx, spawnTerminal } = await providerContext('ok', { executable: 'dsh-freebuff-not-installed' })
    await expect(startAs(ctx, request())).rejects.toMatchObject({ code: 'FREEBUFF_NOT_INSTALLED' })
    expect(spawnTerminal).not.toHaveBeenCalled()
  }, TEST_TIMEOUT_MS)

  it.each(['read-only', 'workspace-write'] as const)('refuses a %s parent session before spawning', async (sandbox) => {
    const { ctx, spawnTerminal } = await providerContext('ok', {}, sandbox)
    await expect(startAs(ctx, request())).rejects.toMatchObject({ code: 'PARENT_SANDBOX_MISMATCH' })
    expect(spawnTerminal).not.toHaveBeenCalled()
  }, TEST_TIMEOUT_MS)

  it('rejects an invalid child cwd', async () => {
    const { ctx } = await providerContext('ok', { cwd: join(tmpdir(), 'dsh-freebuff-missing-dir') })
    await expect(startAs(ctx, request())).rejects.toMatchObject({ code: 'INVALID_CWD' })
  }, TEST_TIMEOUT_MS)
})

describe('Freebuff provider config', () => {
  async function load(config: Partial<Config>): Promise<unknown> {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    return ctx.plugin(freebuff, config)
  }

  it.each(['startupTimeoutMs', 'idleMs', 'timeoutMs', 'disposeGraceMs'] as const)('rejects a non-positive %s', async (field) => {
    await expect(load({ [field]: 0 })).rejects.toThrow(`${field} must be a positive finite number`)
  })

  it.each(['startupTimeoutMs', 'idleMs', 'timeoutMs', 'disposeGraceMs'] as const)('rejects an oversized %s', async (field) => {
    await expect(load({ [field]: MAX_TIMER_DELAY_MS + 1 })).rejects.toThrow(`${field} must be no greater than ${MAX_TIMER_DELAY_MS}`)
  })

  it('registers the provider under the configured name with no start capabilities', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(freebuff, { providerName: 'freebuff-two' })
    expect(ctx.subagents.getProvider('freebuff-two')?.capabilities).toEqual({
      agentOptions: false,
      agentPreset: false,
      outputSchema: false,
      depthLimit: false,
    })
  })
})
