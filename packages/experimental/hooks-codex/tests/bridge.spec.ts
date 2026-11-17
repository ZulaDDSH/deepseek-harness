import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { ALL_HOOKS } from '@deepseek-ai/dsh-hook-protocol'
import { provideWorkingDirectoryFixture, mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { SandboxPolicyService, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { ShellExecutor, type ShellExecRequest, type ShellExecSpec, type ShellExecution, type ShellRunResult } from '@deepseek-ai/dsh-shell'
import * as HooksCodex from '@deepseek-ai/dsh-hooks-codex'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Full-loop Codex bridge tests with a mock model, the real loop and bash
 * executor, and shell hooks from a temporary config. Covers regex matching,
 * block-only decisions, and the five-event subset.
 */

const dirs: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function configDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-codex-'))
  dirs.push(dir)
  return dir
}
function script(dir: string, name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, body)
  chmodSync(path, 0o755)
  return path
}
function writeHooks(dir: string, hooks: unknown): void {
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks }))
}

async function harness(dir: string, adapter: MockAdapter, beforeHooks?: (ctx: Context) => void): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  provideWorkingDirectoryFixture(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
  beforeHooks?.(ctx)
  await ctx.plugin(HooksCodex, { configPath: join(dir, 'hooks.json'), model: 'test-model', enabledHooks: [ALL_HOOKS] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function waitForIdle(_ctx: Context, agent: Agent): Promise<void> {
  return agent.whenIdle()
}
function events(agent: Agent): readonly SessionEvent[] { return agent.session.snapshotEvents() }
type AgentFake = Partial<Omit<Agent, 'session' | 'inbox'>> & { session?: Partial<Agent['session']>; inbox?: Partial<Agent['inbox']> }
function agentFake(fields: AgentFake): Agent { return fields as Agent }

/** Poll `predicate` until true or the deadline passes (detached hook effects can't be awaited directly). */
async function waitFor(predicate: () => boolean, timeout = 5000, interval = 10): Promise<void> {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before deadline')
    await new Promise(r => setTimeout(r, interval))
  }
}

describe('unmatched hooks and directory recovery', () => {
  it.each([
    {},
    { PreToolUse: [{ matcher: 'AnotherTool', hooks: [{ type: 'command', command: 'exit 1' }] }] },
    { PreToolUse: [{ hooks: [] }] },
  ])('does not validate a missing directory when no hook command will run', async (hooks) => {
    const dir = configDir()
    writeHooks(dir, hooks)
    const ctx = await harness(dir, new MockAdapter([]))
    const ensure = vi.spyOn(ctx.get('workingDirectory')!, 'ensure')
      .mockRejectedValue(new Error('original directory is missing'))
    try {
      ctx.tools.register(defineContentToolFixture({
        name: 'working_directory', description: 'recover a directory',
        parameters: { cd: { type: 'string', required: true } },
        async execute(args) { return [{ type: 'text', text: args.cd }] },
      }))
      const agent = await ctx.agentLoop.create(SessionId('recovery'), { provider: 'mock', model: 'mock' })
      const result = await executeToolFixture(ctx, {
        name: 'working_directory', callId: ToolCallId('recover'), arguments: { cd: dir },
        agent, signal: new AbortController().signal,
      })
      expect(result.isError).toBe(false)
      expect(ensure).not.toHaveBeenCalled()
    } finally {
      ensure.mockRestore()
      await ctx.fiber.dispose()
    }
  })
})

describe('hooks-codex bridge', () => {
  it.each([
    ['edit', { file_path: 'src/example.ts', old_string: 'before', new_string: 'after' }],
    ['edit', { file_path: 'src/example.ts', old_string: 'before', new_string: '' }],
    ['write', { file_path: 'src/example.ts', content: 'after' }],
    ['apply_patch', { patch: '*** Begin Patch\n*** Update File: src/example.ts\n@@\n-before\n+after\n*** End Patch' }],
    ['Bash', { command: 'Get-ChildItem', workdir: 'project' }],
  ] as const)('preserves %s arguments for both tool hook events', async (name, input) => {
    const dir = configDir()
    writeHooks(dir, {
      PreToolUse: [{ hooks: [{ type: 'command', command: 'capture-pre' }] }],
      PostToolUse: [{ hooks: [{ type: 'command', command: 'capture-post' }] }],
    })
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(RecordingShell)
    await ctx.plugin(HooksCodex, { configPath: join(dir, 'hooks.json'), model: 'test-model', enabledHooks: [ALL_HOOKS] })
    const execute = vi.fn(async () => [{ type: 'text' as const, text: 'ok' }])
    ctx.tools.register(defineContentToolFixture({ name, description: name, parameters: {
      file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' },
      content: { type: 'string' }, patch: { type: 'string' },
      command: { type: 'string' }, workdir: { type: 'string' },
    }, execute }))
    await executeToolFixture(ctx, { signal: new AbortController().signal, callId: ToolCallId('c1'), name, arguments: input })
    expect(execute).toHaveBeenCalledTimes(1)
    const specs = (ctx.shell as RecordingShell).specs
    expect(specs).toHaveLength(2)
    for (const spec of specs) {
      const payload = JSON.parse(String(spec.stdin)) as { tool_name: string; tool_input: unknown }
      expect(payload.tool_name).toBe(name)
      expect(payload.tool_input).toEqual(input)
    }
  })

  it('awaits a registry-announced resume hook without a creation signal', async () => {
    const dir = configDir()
    const capture = script(dir, 'resume.sh', '#!/usr/bin/env bash\necho "resumed context"\n')
    writeHooks(dir, { SessionStart: [{ matcher: 'resume', hooks: [{ type: 'command', command: capture }] }] })
    const ctx = await harness(dir, new MockAdapter([]))
    const session = ctx.sessions.create(SessionId('registry-resume'))
    const inject = vi.fn()
    const agent = { id: session.id, session, ctx, inject } as unknown as Agent

    ctx.effect(() => ctx.agents.enter(agent, undefined))
    await ctx.agents.announce(agent, 'resume')

    expect(inject).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: 'resumed context' }],
    }))
  })

  it('skips SessionStart hooks for CLI terminal Sessions and still runs them for other Sessions', async () => {
    const dir = configDir()
    const capture = script(dir, 'resume.sh', '#!/usr/bin/env bash\necho "resumed context"\n')
    writeHooks(dir, { SessionStart: [{ matcher: 'resume', hooks: [{ type: 'command', command: capture }] }] })
    const ctx = await harness(dir, new MockAdapter([]))
    const cli = ctx.sessions.create(SessionId('cli-resume'))
    cli.append('session/cli-terminal', { profile: 'grok-cli' })
    const plain = ctx.sessions.create(SessionId('plain-resume'))
    const injectCli = vi.fn()
    const injectPlain = vi.fn()
    const cliAgent = agentFake({ id: cli.id, session: cli, ctx, inject: injectCli })
    const plainAgent = agentFake({ id: plain.id, session: plain, ctx, inject: injectPlain })

    ctx.effect(() => ctx.agents.enter(cliAgent, undefined))
    ctx.effect(() => ctx.agents.enter(plainAgent, undefined))
    await ctx.agents.announce(cliAgent, 'resume')
    await ctx.agents.announce(plainAgent, 'resume')

    expect(injectPlain).toHaveBeenCalledTimes(1)
    expect(injectCli).not.toHaveBeenCalled()
  })

  it('a PreToolUse hook (exit 2) denies a tool the regex matcher matches as a substring', async () => {
    const dir = configDir()
    const deny = script(dir, 'deny.sh', '#!/usr/bin/env bash\necho "codex blocked it" >&2\nexit 2\n')
    // Codex regex matcher: "Bash" is /Bash/ — matches the tool name "Bash".
    writeHooks(dir, { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: deny }] }] })

    const adapter = new MockAdapter([toolCallResponse('c1', 'Bash', { command: 'ls' }), textResponse('done')])
    const ctx = await harness(dir, adapter)
    let ran = false
    ctx.tools.register(defineContentToolFixture({ name: 'Bash', description: 'b', parameters: { command: { type: 'string' } }, async execute() { ran = true; return [{ type: 'text', text: 'no' }] } }))
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run ls' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(ran).toBe(false)
    const result = events(agent).find(e => e.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.message.isError).toBe(true)
    expect(result?.type === 'tool/result' && result.data.message.content.some(b => b.type === 'text' && b.text.includes('codex blocked it'))).toBe(true)
    expect(events(agent).some(e => e.type === 'hook/invoked' && e.data.dialect === 'codex' && e.data.point === 'PreToolUse')).toBe(true)
  })

  it('a Stop hook (exit 2) forces the turn to continue with the reason as steering', async () => {
    const dir = configDir()
    // Stop ignores its malformed matcher field. Block once with a marker.
    const marker = join(dir, 'fired')
    const cont = script(dir, 'cont.sh', `#!/usr/bin/env bash\nif [ -e "${marker}" ]; then exit 0; fi\ntouch "${marker}"\necho "keep going: address the goal" >&2\nexit 2\n`)
    writeHooks(dir, { Stop: [{ matcher: '[', hooks: [{ type: 'command', command: cont }] }] })

    const adapter = new MockAdapter([textResponse('first answer'), textResponse('second answer after goal')])
    const ctx = await harness(dir, adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('keep going: address the goal')
  }, 15_000) // Two real hook subprocesses and agent steps need startup and teardown headroom under load.

  it('turn cancellation aborts and reaps a running UserPromptSubmit hook before idle', async () => {
    const dir = configDir()
    const pidFile = join(dir, 'pid')
    const marker = join(dir, 'started')
    const slow = script(dir, 'slow-prompt.sh', `#!/usr/bin/env bash\necho $$ > "${pidFile}"\ntouch "${marker}"\nsleep 30\n`)
    writeHooks(dir, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: slow }] }] })

    const adapter = new MockAdapter([textResponse('must not run')])
    const ctx = await harness(dir, adapter)
    const agent = await ctx.agentLoop.create(SessionId('cancel-prompt-hook'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'cancel the hook' }], source: { kind: 'user' } }))
    await waitFor(() => existsSync(marker))
    const pid = Number(readFileSync(pidFile, 'utf8').trim())

    const idle = agent.whenIdle()
    agent.cancel({ kind: 'user' })
    await idle

    expect(() => process.kill(pid, 0)).toThrow()
    expect(adapter.requests).toHaveLength(0)
    expect(events(agent).filter(event => event.type === 'turn/start' || event.type === 'hook/invoked'
      || event.type === 'hook/result' || event.type === 'turn/end').map(event => event.type))
      .toEqual(['turn/start', 'hook/invoked', 'hook/result', 'turn/end'])
  })

  it('only the five bridge-supported Codex events are honored — a SubagentStop entry is ignored', async () => {
    const dir = configDir()
    const s = script(dir, 'x.sh', '#!/usr/bin/env bash\nexit 2\n')
    writeHooks(dir, { SubagentStop: [{ hooks: [{ type: 'command', command: s }] }] })

    const adapter = new MockAdapter([textResponse('fine')])
    const ctx = await harness(dir, adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
  })

  it('a missing config registers no hooks and does not crash', async () => {
    const dir = configDir() // no hooks.json written
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(dir, adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
  })

  it('an invalid regex matcher is reported and registers no hooks', async () => {
    const dir = configDir()
    writeHooks(dir, {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'exit 2' }] }],
      PreToolUse: [{ matcher: '[', hooks: [{ type: 'command', command: 'exit 2' }] }],
    })
    const adapter = new MockAdapter([textResponse('ok')])
    const warn = vi.fn()
    const ctx = await harness(dir, adapter, (ctx) => { ctx.logger.warn = warn as never })
    const agent = await ctx.agentLoop.create(SessionId('invalid-codex-matcher'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
    expect(events(agent).some(event => event.type === 'hook/invoked')).toBe(false)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(
      'invalid codex regex matcher "[" on event "PreToolUse"',
    ))
  })

  it('disposing the bridge fiber removes its listeners (HMR safety)', async () => {
    const dir = configDir()
    // A leaked listener would let this blocking hook veto the prompt and log an invocation; a
    // no-op hook would pass even when leaked.
    const deny = script(dir, 'deny.sh', '#!/usr/bin/env bash\nexit 2\n')
    writeHooks(dir, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: deny }] }] })
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = new Context()
    provideWorkingDirectoryFixture(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
    const fiber = await ctx.plugin(HooksCodex, { configPath: join(dir, 'hooks.json'), model: 'm', enabledHooks: [ALL_HOOKS] })
    await fiber.dispose()
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1) // not blocked → the listener is gone
    expect(events(agent).some(e => e.type === 'hook/invoked')).toBe(false) // no hook ran
  })

  it('disposing the bridge aborts a still-running SessionStart hook and drains to quiescence', async () => {
    const dir = configDir()
    const pidFile = join(dir, 'pid')
    const marker = join(dir, 'started')
    // Record the PID and marker before sleeping past the suite timeout. Disposal must abort the
    // tracked process through `runPoint`, not await its natural exit.
    const slow = script(dir, 'slow.sh', `#!/usr/bin/env bash\necho $$ > "${pidFile}"\ntouch "${marker}"\nsleep 30\n`)
    writeHooks(dir, { SessionStart: [{ hooks: [{ type: 'command', command: slow }] }] })
    const ctx = new Context()
    provideWorkingDirectoryFixture(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
    const fiber = await ctx.plugin(HooksCodex, { configPath: join(dir, 'hooks.json'), model: 'm', enabledHooks: [ALL_HOOKS] })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
    const warn = vi.fn()
    ctx.logger.warn = warn as never
    const creating = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    try {
      await waitFor(() => existsSync(marker))
      const pid = Number(readFileSync(pidFile, 'utf8').trim())
      await fiber.dispose()
      await creating
      // The aborted hook must be reaped before bridge disposal resolves.
      expect(() => process.kill(pid, 0)).toThrow()
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('SessionStart hook failed'))
    } finally {
      await fiber.dispose()
      await creating
      await ctx.fiber.dispose()
    }
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    expect('default' in HooksCodex).toBe(false)
    expect(HooksCodex.name).toBe('hooks-codex')
    expect(HooksCodex.inject).toEqual(['shell', 'agents', 'workingDirectory'])
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(HooksCodex) as Record<string, unknown>
    expect(unwrapped).toBe(HooksCodex)
    expect(unwrapped.name).toBe('hooks-codex')
    expect(unwrapped.inject).toEqual(['shell', 'agents', 'workingDirectory'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})

describe('hooks-codex bridge — tool aliases and run control', () => {
  it('a Codex Bash matcher fires on the DSH pwsh tool and the payload names it Bash', async () => {
    const dir = configDir()
    const payload = join(dir, 'payload')
    const capture = script(dir, 'capture.sh', `#!/usr/bin/env bash\ncat > "${payload}"\nexit 2\n`)
    writeHooks(dir, { PreToolUse: [{ matcher: '^Bash$', hooks: [{ type: 'command', command: capture }] }] })

    const adapter = new MockAdapter([toolCallResponse('c1', 'pwsh', { command: 'Get-ChildItem' }), textResponse('done')])
    const ctx = await harness(dir, adapter)
    let ran = false
    ctx.tools.register(defineContentToolFixture({ name: 'pwsh', description: 'p', parameters: { command: { type: 'string' } }, async execute() { ran = true; return [{ type: 'text', text: 'ran' }] } }))
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'list' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(ran).toBe(false)
    expect(JSON.parse(readFileSync(payload, 'utf8'))).toMatchObject({ tool_name: 'Bash', tool_input: { command: 'Get-ChildItem' } })
  }, 15_000)

  it('an always-blocking Stop hook forces at most maxForcedStops continuations and reports stop_hook_active', async () => {
    const dir = configDir()
    const payloads = join(dir, 'payloads')
    // Codex stdin has no trailing newline, so the capture adds one to split the payloads.
    const stop = script(dir, 'stop.sh', `#!/usr/bin/env bash\ncat >> "${payloads}"\necho >> "${payloads}"\necho "keep going" >&2\nexit 2\n`)
    writeHooks(dir, { Stop: [{ hooks: [{ type: 'command', command: stop }] }] })

    const adapter = new MockAdapter([textResponse('1'), textResponse('2'), textResponse('3'), textResponse('4'), textResponse('5')])
    const warn = vi.fn()
    const ctx = await harness(dir, adapter, (ctx) => { ctx.logger.warn = warn as never })
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // Three forced continuations, then the fourth Stop block lets the turn end.
    expect(adapter.requests).toHaveLength(4)
    const flags = readFileSync(payloads, 'utf8').split('\n').filter(line => line.length > 0)
      .map(line => (JSON.parse(line) as { stop_hook_active: boolean }).stop_hook_active)
    expect(flags).toEqual([false, true, true, true])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Stop hook blocked 3 times'))
  }, 15_000)

  it('a Stop block with {"continue":false} halts instead of steering', async () => {
    const dir = configDir()
    const stop = script(dir, 'stop.sh', '#!/usr/bin/env bash\necho \'{"decision":"block","reason":"more","continue":false,"stopReason":"halt"}\'\n')
    writeHooks(dir, { Stop: [{ hooks: [{ type: 'command', command: stop }] }] })

    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(dir, adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // No steer: the second model step never runs, and the turn ends on the hook halt.
    expect(adapter.requests).toHaveLength(1)
    const turnEnd = events(agent).findLast(e => e.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'hook', reason: 'halt' } })
  }, 15_000)

  it('a {"continue":false} UserPromptSubmit hook halts before any model call', async () => {
    const dir = configDir()
    const halt = script(dir, 'halt.sh', '#!/usr/bin/env bash\necho \'{"continue":false}\'\n')
    writeHooks(dir, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: halt }] }] })

    const adapter = new MockAdapter([textResponse('should not run')])
    const ctx = await harness(dir, adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(0)
  }, 15_000)

  it('a no-agent direct call is denied by a {"continue":false} PreToolUse hook', async () => {
    const dir = configDir()
    const halt = script(dir, 'halt.sh', '#!/usr/bin/env bash\necho \'{"continue":false}\'\n')
    writeHooks(dir, { PreToolUse: [{ hooks: [{ type: 'command', command: halt }] }] })

    const ctx = await harness(dir, new MockAdapter([]))
    let ran = false
    ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'e', parameters: {}, async execute() { ran = true; return [{ type: 'text', text: 'ok' }] } }))
    const result = await executeToolFixture(ctx, { signal: new AbortController().signal, callId: ToolCallId('c1'), name: 'echo', arguments: {} })

    expect(ran).toBe(false)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('blocked by PreToolUse hook')
  }, 15_000)
})

class RecordingShell extends ShellExecutor {
  readonly specs: ShellExecSpec[] = []

  override get sandboxMode() {
    return 'workspace-write' as const
  }

  resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      timeoutMs: request.timeoutMs ?? 1000,
      onExpiry: request.onExpiry ?? 'kill',
      ...request.signal ? { signal: request.signal } : {},
      ...request.stdin !== undefined ? { stdin: request.stdin } : {},
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  async execute(spec: ShellExecSpec): Promise<ShellExecution> {
    this.specs.push(spec)
    const silent = { readFrom: (from: number) => ({ text: '', nextOffset: from, lossy: false }) }
    const run: ShellRunResult = {
      exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: spec.timeoutMs,
      stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false },
    }
    return {
      status: 'completed',
      exitCode: 0,
      signal: null,
      done: Promise.resolve(),
      readOutput: () => ({ delta: '', lossy: false }),
      observed: { stdout: silent, stderr: silent },
      kill: () => false,
      result: () => Promise.resolve(run),
    }
  }
}

describe('hooks-codex bridge — sandbox policy', () => {
  it('a hook run for a session carries that session sandbox policy, not the deployment default', async () => {
    const dir = configDir()
    const hook = script(dir, 'hook.sh', '#!/usr/bin/env bash\nexit 0\n')
    writeHooks(dir, { UserPromptSubmit: [{ hooks: [{ type: 'command', command: hook }] }] })

    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: dir })
    await ctx.plugin(RecordingShell)
    await ctx.plugin(HooksCodex, { configPath: join(dir, 'hooks.json'), model: 'test-model', enabledHooks: [ALL_HOOKS] })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('ok')]))
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    setSandboxMode(agent.session, 'danger-full-access')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const spec = (ctx.shell as RecordingShell).specs.find(candidate => candidate.command === hook)
    expect(spec?.sandboxPolicy).toEqual(expect.objectContaining({ mode: 'danger-full-access', sessionId: agent.session.id }))
  })
})
