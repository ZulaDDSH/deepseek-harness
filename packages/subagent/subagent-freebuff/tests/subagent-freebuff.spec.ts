import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  const realSpawn = ctx.subprocess.spawnTerminal.bind(ctx.subprocess)
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
  return { ctx, spawnTerminal, realSpawn, configDir }
}

async function fakePid(configDir: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return Number(readFileSync(join(configDir, 'fake.pid'), 'utf8'))
    } catch (_notYet) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  throw new Error('the fake Freebuff never wrote its pid')
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
    const { ctx, configDir } = await providerContext('ok')
    const run = await startAs(ctx, request('first line\nsecond line'))
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: (expect.stringContaining('FAKE-ANSWER lines=2 esc=false trust=none args=') as string) }],
      stopReason: 'completed',
    })
    const pid = await fakePid(configDir)
    await run.dispose()
    expect(isAlive(pid)).toBe(false)
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
    expect(result.output).toEqual([{ type: 'text', text: (expect.stringContaining('lines=2 esc=false') as string) }])
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('appends extra arguments and the trust flag after the configured arguments', async () => {
    const { ctx, spawnTerminal } = await providerContext('trust', { args: [FAKE, '--extra'], trustAgents: true })
    const run = await startAs(ctx, request())
    const result = await run.result
    expect(result.output).toEqual([{ type: 'text', text: (expect.stringContaining('trust=flag args=--extra,--trust-agents') as string) }])
    expect(spawnTerminal.mock.calls[0]![0].argv).toEqual([process.execPath, FAKE, '--extra', '--trust-agents'])
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('declines the project agents trust prompt by default', async () => {
    const { ctx } = await providerContext('trust')
    const run = await startAs(ctx, request())
    const result = await run.result
    expect(result.output).toEqual([{ type: 'text', text: (expect.stringContaining('trust=n') as string) }])
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('fails with the typed not-logged-in error when the login screen shows', async () => {
    const { ctx } = await providerContext('login')
    await expect(startAs(ctx, request())).rejects.toMatchObject({
      code: 'FREEBUFF_NOT_LOGGED_IN',
      message: (expect.stringContaining('freebuff login') as string),
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

  it('keeps screen rows out of the warning and logs them at debug level', async () => {
    const { ctx } = await providerContext('exit')
    const warn = vi.spyOn(ctx.logger, 'warn')
    const debug = vi.spyOn(ctx.logger, 'debug')
    await expect(startAs(ctx, request())).rejects.toMatchObject({ code: 'FREEBUFF_RUN_FAILED' })
    const failed = warn.mock.calls.map(([message]) => String(message)).filter(message => message.includes('child run failed'))
    expect(failed).toHaveLength(1)
    expect(failed[0]).not.toContain('\n')
    expect(debug.mock.calls.some(([message]) => String(message).includes('last screen rows'))).toBe(true)
  }, TEST_TIMEOUT_MS)

  it('puts the product error text from the transcript into the diagnostic', async () => {
    const { ctx } = await providerContext('error', { env: { FAKE_FREEBUFF_TRANSCRIPT: '1' } })
    const run = await startAs(ctx, request())
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: product-error')
    expect(result.diagnostic).toContain('Freebuff reported an error: boom: usage policy refusal')
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('reports a long refusal whole, keeping its line breaks', async () => {
    const refusal = `Your request was refused by the usage policy.
${'Detailed reason. '.repeat(60)}End of refusal.`
    const { ctx } = await providerContext('error', { env: { FAKE_FREEBUFF_TRANSCRIPT: '1', FAKE_FREEBUFF_REFUSAL: refusal } })
    const run = await startAs(ctx, request())
    const result = await run.result
    expect(result.diagnostic).toContain(`Freebuff reported an error: ${refusal}`)
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('completes when a recoverable product error is followed by a complete answer', async () => {
    const { ctx } = await providerContext('recover', { env: { FAKE_FREEBUFF_TRANSCRIPT: '1' } })
    const run = await startAs(ctx, request())
    await expect(run.result).resolves.toEqual({ output: [{ type: 'text', text: 'RECOVERED-ANSWER' }], stopReason: 'completed' })
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('ignores a chat transcript of another run that is newer but has a different task', async () => {
    const { ctx } = await providerContext('foreign', { env: { FAKE_FREEBUFF_TRANSCRIPT: '1' } })
    const run = await startAs(ctx, request())
    await expect(run.result).resolves.toEqual({ output: [{ type: 'text', text: 'TRANSCRIPT-ANSWER' }], stopReason: 'completed' })
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('does not mistake a marker quoted in the task or the answer for a blocker or a busy indicator', async () => {
    const { ctx } = await providerContext('quote')
    const run = await startAs(ctx, request("Explain what 'Press ENTER to login...' and 'Enter: take over' mean"))
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: (expect.stringContaining('The footer says thinking... while a turn runs.') as string) }])
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('does not treat an answer that ends with a login hint as a signed-out screen', async () => {
    const { ctx } = await providerContext('login-answer')
    const run = await startAs(ctx, request())
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: (expect.stringContaining('Run this command to login:') as string) }])
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('fails with the prompt named when a blocker appears after Freebuff started working', async () => {
    const { ctx } = await providerContext('blocked-late', { timeoutMs: 20_000 })
    const run = await startAs(ctx, request())
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: blocked')
    expect(result.diagnostic).toContain('Enter: take over')
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it('flags a screen answer whose task echo scrolled off the screen', async () => {
    const { ctx } = await providerContext('long')
    const run = await startAs(ctx, request())
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: (expect.stringContaining('may be incomplete') as string) }])
    await run.dispose()
  }, TEST_TIMEOUT_MS)

  it.each(['/logout', '!dir'])('rejects a task that Freebuff would run as a terminal command (%s)', async (task) => {
    const { ctx, spawnTerminal } = await providerContext('ok')
    await expect(startAs(ctx, request(task))).rejects.toThrow('must not start with "/" or "!"')
    expect(spawnTerminal).not.toHaveBeenCalled()
  }, TEST_TIMEOUT_MS)

  it('terminates the process when the request is aborted while the terminal starts', async () => {
    const abort = new AbortController()
    const { ctx, spawnTerminal, realSpawn } = await providerContext('ok')
    spawnTerminal.mockImplementation(async (spec) => {
      const handle = await realSpawn(spec)
      abort.abort()
      return handle
    })
    await expect(startAs(ctx, request('do the task', abort.signal))).rejects.toThrow()
    const handle = await spawnTerminal.mock.results[0]!.value as { done: Promise<unknown> }
    await expect(handle.done).resolves.toBeDefined()
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

  it('settles as aborted and kills the process when the published run is disposed', async () => {
    const { ctx, configDir } = await providerContext('hang')
    const run = await startAs(ctx, request())
    const pid = await fakePid(configDir)
    expect(isAlive(pid)).toBe(true)
    const disposing = run.dispose()
    await expect(run.result).resolves.toMatchObject({ stopReason: 'aborted' })
    await disposing
    expect(isAlive(pid)).toBe(false)
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
