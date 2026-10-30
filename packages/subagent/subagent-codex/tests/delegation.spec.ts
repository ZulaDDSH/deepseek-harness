import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'

async function startAs(ctx: Context, provider: string, { signal, ...request }: SubagentStartRequest) {
  if (ctx.agents.get(request.parent.id) !== request.parent) await ctx.agents.register(request.parent)
  return ctx.subagents.startActivation({ provider, label: 'provider task', request, signal, delivery: 'caller' })
}
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as codex from '../src/index.ts'
import type { Config as CodexConfig } from '../src/index.ts'
import {
  DEFAULT_DISPOSE_GRACE_MS,
  startCodexRun,
  type CodexPermissionMode,
  type CodexRunSpec,
} from '../src/run.ts'
import { codexThreadPermission } from '../src/permission.ts'
import { CodexAppServerWire } from '../src/wire.ts'
import {
  agentMessage,
  expectedFailureDiagnostic,
  fakeChild,
  type FakeChild,
  nextTask,
  turnCompleted,
} from './codex-fakes.ts'

type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

const fakeParent: Agent = {
  id: 'parent',
  session: { id: 'parent', header: { cwd: process.cwd() } },
} as never

const MODES: readonly CodexPermissionMode[] = [
  'never',
  'approve-for-me',
  'dangerously-bypass-approvals-and-sandbox',
]

function request(prompt: ContentBlock[] = [{ type: 'text', text: 'do the task' }]) {
  return { prompt, parent: fakeParent, signal: new AbortController().signal }
}

async function providerContext(
  config: Partial<CodexConfig>,
  sandbox?: SandboxMode,
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
  const spawn = vi.spyOn(ctx.subprocess, 'spawn').mockReturnValue(child.handle)
  await ctx.plugin(codex, { env: {}, disposeGraceMs: 3_000, ...config })
  return { ctx, child, spawn }
}

async function startThread(ctx: Context, child: FakeChild) {
  const starting = startAs(ctx, 'codex', request())
  const initialize = await child.peer.nextMethod('initialize')
  child.peer.respond(initialize, { userAgent: 'codex-cli 0.153.4' })
  await child.peer.nextMethod('initialized')
  const threadStart = await child.peer.nextMethod('thread/start')
  child.peer.respond(threadStart, { thread: { id: 'thread-1', ephemeral: true } })
  return { threadStart, run: await starting }
}

describe('codexThreadPermission', () => {
  const official: Record<CodexPermissionMode, Record<string, unknown>> = {
    never: { approvalPolicy: 'never' },
    'approve-for-me': {
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandbox: 'workspace-write',
    },
    'dangerously-bypass-approvals-and-sandbox': {
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    },
  }

  it.each(MODES)('returns the unclamped fields for %s without a restricting parent', (mode) => {
    expect(codexThreadPermission(mode)).toEqual(official[mode])
    expect(codexThreadPermission(mode, 'danger-full-access')).toEqual(official[mode])
  })

  it.each([
    ['never', { approvalPolicy: 'never', sandbox: 'workspace-write' }],
    ['approve-for-me', { approvalPolicy: 'never', sandbox: 'workspace-write' }],
  ] as const)('forces %s under a workspace-write parent to never with a workspace-write sandbox', (mode, expected) => {
    expect(codexThreadPermission(mode, 'workspace-write')).toEqual(expected)
  })

  it.each(MODES.filter(mode => mode !== 'dangerously-bypass-approvals-and-sandbox'))(
    'forces %s under a read-only parent to never with a read-only sandbox',
    (mode) => {
      expect(codexThreadPermission(mode, 'read-only')).toEqual({
        approvalPolicy: 'never',
        sandbox: 'read-only',
      })
    },
  )

  it.each(['workspace-write', 'read-only'] as const)(
    'refuses the bypass mode under a %s parent',
    (parent) => {
      let failure: unknown
      try {
        codexThreadPermission('dangerously-bypass-approvals-and-sandbox', parent)
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toMatchObject({ code: 'PARENT_SANDBOX_MISMATCH' })
      expect(failure).toMatchObject({
        message: `subagent-codex: permissionMode "dangerously-bypass-approvals-and-sandbox" requires a danger-full-access parent session; the parent session is ${parent}`,
      })
    },
  )
})

describe('Codex provider under a delegating parent sandbox', () => {
  it('clamps approve-for-me to a read-only sandbox with no reviewer', async () => {
    const { ctx, child } = await providerContext(
      { permissionMode: 'approve-for-me' },
      'read-only',
    )
    const { threadStart, run } = await startThread(ctx, child)
    expect(threadStart.params).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'read-only',
    })
    expect(threadStart.params).not.toHaveProperty('approvalsReviewer')
    const turnStart = await child.peer.nextMethod('turn/start')
    child.peer.send(
      { id: turnStart.id, result: { turn: { id: 'turn-1' } } },
      agentMessage('read-only answer', 'final_answer'),
      turnCompleted('completed'),
    )
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'read-only answer' }],
      stopReason: 'completed',
    })
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('pins the never mode to a workspace-write sandbox', async () => {
    const { ctx, child } = await providerContext(
      { permissionMode: 'never' },
      'workspace-write',
    )
    const { threadStart, run } = await startThread(ctx, child)
    expect(threadStart.params).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
    })
    const turnStart = await child.peer.nextMethod('turn/start')
    child.peer.send(
      { id: turnStart.id, result: { turn: { id: 'turn-1' } } },
      agentMessage('workspace answer', 'final_answer'),
      turnCompleted('completed'),
    )
    await expect(run.result).resolves.toMatchObject({ stopReason: 'completed' })
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('refuses the bypass mode under a workspace-write parent before spawning', async () => {
    const { ctx, spawn } = await providerContext(
      { permissionMode: 'dangerously-bypass-approvals-and-sandbox' },
      'workspace-write',
    )
    await expect(startAs(ctx, 'codex', request()))
      .rejects.toMatchObject({ code: 'PARENT_SANDBOX_MISMATCH' })
    expect(spawn).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('keeps the bypass sandbox when no sandbox policy is composed', async () => {
    const { ctx, child } = await providerContext({
      permissionMode: 'dangerously-bypass-approvals-and-sandbox',
    })
    const { threadStart, run } = await startThread(ctx, child)
    expect(threadStart.params).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    })
    const turnStart = await child.peer.nextMethod('turn/start')
    child.peer.send(
      { id: turnStart.id, result: { turn: { id: 'turn-1' } } },
      agentMessage('bypass answer', 'final_answer'),
      turnCompleted('completed'),
    )
    await expect(run.result).resolves.toMatchObject({ stopReason: 'completed' })
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('records the parent sandbox clamp in a failed run diagnostic', async () => {
    const { ctx, child } = await providerContext(
      { permissionMode: 'approve-for-me' },
      'read-only',
    )
    const { run } = await startThread(ctx, child)
    const turnStart = await child.peer.nextMethod('turn/start')
    child.peer.send(
      { id: turnStart.id, result: { turn: { id: 'turn-1' } } },
      turnCompleted('failed', 'turn-1', 'thread-1', {
        message: 'failed',
        codexErrorInfo: 'other',
      }),
    )
    await expect(run.result).resolves.toMatchObject({
      diagnostic: `${expectedFailureDiagnostic('turn', 'product-error')}\nCodex sandbox limited to read-only by the parent session`,
    })
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('forces approve-for-me to never under a workspace-write parent and notes the clamp', async () => {
    const { ctx, child } = await providerContext(
      { permissionMode: 'approve-for-me' },
      'workspace-write',
    )
    const { threadStart, run } = await startThread(ctx, child)
    expect(threadStart.params).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
    })
    expect(threadStart.params).not.toHaveProperty('approvalsReviewer')
    const turnStart = await child.peer.nextMethod('turn/start')
    child.peer.send(
      { id: turnStart.id, result: { turn: { id: 'turn-1' } } },
      turnCompleted('failed', 'turn-1', 'thread-1', {
        message: 'failed',
        codexErrorInfo: 'other',
      }),
    )
    await expect(run.result).resolves.toMatchObject({
      diagnostic: `${expectedFailureDiagnostic('turn', 'product-error')}\nCodex sandbox limited to workspace-write by the parent session`,
    })
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('omits the sandbox clamp note when the parent sandbox changes nothing', async () => {
    const { ctx, child } = await providerContext(
      { permissionMode: 'approve-for-me' },
      'danger-full-access',
    )
    const { run } = await startThread(ctx, child)
    const turnStart = await child.peer.nextMethod('turn/start')
    child.peer.send(
      { id: turnStart.id, result: { turn: { id: 'turn-1' } } },
      turnCompleted('failed', 'turn-1', 'thread-1', {
        message: 'failed',
        codexErrorInfo: 'other',
      }),
    )
    const result = await run.result
    expect(result.diagnostic).toBe(expectedFailureDiagnostic('turn', 'product-error'))
    expect(result.diagnostic).not.toContain('Codex sandbox limited')
    await run.dispose()
    await ctx.fiber.dispose()
  })
})

function runSpec(child: FakeChild, overrides: Partial<CodexRunSpec> = {}): CodexRunSpec {
  return {
    cwd: process.cwd(),
    permissionMode: 'never',
    env: {},
    disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
    spawn: () => child.handle,
    ...overrides,
  }
}

async function publishRun(
  child: FakeChild,
  spec: CodexRunSpec,
  start: Parameters<typeof startCodexRun>[0] = request(),
) {
  const starting = startCodexRun(start, spec)
  const initialize = await child.peer.nextMethod('initialize')
  child.peer.respond(initialize, { userAgent: 'codex-cli 0.153.4' })
  await child.peer.nextMethod('initialized')
  const threadStart = await child.peer.nextMethod('thread/start')
  child.peer.respond(threadStart, { thread: { id: 'thread-1', ephemeral: true } })
  const run = await starting
  const turnStart = await child.peer.nextMethod('turn/start')
  return { run, turnStart }
}

function itemCompleted(item: Record<string, unknown>): Record<string, unknown> {
  return {
    method: 'item/completed',
    params: { threadId: 'thread-1', turnId: 'turn-1', item },
  }
}

describe('Codex timeoutMs configuration', () => {
  it('accepts an optional positive wall-clock limit and rejects others', async () => {
    expect(codex.Config({ timeoutMs: 1000 }).timeoutMs).toBe(1000)
    expect(codex.Config({}).timeoutMs).toBeUndefined()
    await expect(providerContext({ timeoutMs: 0 }))
      .rejects.toThrow('timeoutMs must be a positive finite number')
    await expect(providerContext({ timeoutMs: Number.NaN }))
      .rejects.toThrow('timeoutMs must be a positive finite number')
    await expect(providerContext({ timeoutMs: MAX_TIMER_DELAY_MS + 1 }))
      .rejects.toThrow(`timeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  })
})

describe('Codex published-run wall-clock limit', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancels the published run at the deadline and settles it as a limit error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const child = fakeChild()
    const { run, turnStart } = await publishRun(child, runSpec(child, { timeoutMs: 1000 }))
    child.peer.respond(turnStart, { turn: { id: 'turn-1' } })
    await nextTask()

    vi.advanceTimersByTime(999)
    let settled = false
    void run.result.then(() => { settled = true })
    await nextTask()
    expect(settled).toBe(false)

    vi.advanceTimersByTime(1)
    await child.peer.nextMethod('turn/interrupt')
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: limit; detail: exceeded timeoutMs (1000 ms)')
    await run.dispose()
  })
})

describe('Codex advisory progress lines', () => {
  it('emits command and file-change lines from the wire but not declined items', async () => {
    const child = fakeChild()
    const onProgress = vi.fn()
    const wire = new CodexAppServerWire(
      child.fromChild,
      child.toChild,
      'never',
      undefined,
      { onProgress },
    )
    wire.start()
    const initializing = wire.initialize(new AbortController().signal)
    const initialize = await child.peer.nextMethod('initialize')
    child.peer.respond(initialize, { userAgent: 'codex-cli 0.153.4' })
    await initializing
    await child.peer.nextMethod('initialized')
    const starting = wire.startThread(process.cwd(), new AbortController().signal)
    const threadStart = await child.peer.nextMethod('thread/start')
    child.peer.respond(threadStart, { thread: { id: 'thread-1', ephemeral: true } })
    await starting

    const running = wire.runTurn(['do the task'], new AbortController().signal)
    const turnStart = await child.peer.nextMethod('turn/start')
    child.peer.send(
      { id: turnStart.id, result: { turn: { id: 'turn-1' } } },
      itemCompleted({ type: 'commandExecution', status: 'completed', command: 'pnpm test' }),
      itemCompleted({
        type: 'fileChange',
        status: 'completed',
        changes: [{ path: 'src/a.ts', kind: 'update' }, { path: 'src/b.ts', kind: 'add' }],
      }),
      itemCompleted({ type: 'commandExecution', status: 'declined', command: 'rm -rf dist' }),
      agentMessage('done', 'final_answer'),
      turnCompleted('completed'),
    )
    await expect(running).resolves.toEqual({
      output: [{ type: 'text', text: 'done' }],
      stopReason: 'completed',
    })
    expect(onProgress.mock.calls).toEqual([
      ['Command: pnpm test'],
      ['Edit: src/a.ts, src/b.ts'],
    ])
    wire.close()
  })

  it('hands the first progress line to the request sink through startCodexRun', async () => {
    const child = fakeChild()
    const onProgress = vi.fn()
    const { run, turnStart } = await publishRun(child, runSpec(child), {
      ...request(),
      onProgress,
    })
    child.peer.send(
      { id: turnStart.id, result: { turn: { id: 'turn-1' } } },
      itemCompleted({ type: 'commandExecution', status: 'completed', command: 'pnpm test' }),
      agentMessage('done', 'final_answer'),
      turnCompleted('completed'),
    )
    await expect(run.result).resolves.toMatchObject({ stopReason: 'completed' })
    expect(onProgress).toHaveBeenCalledWith('Command: pnpm test')
    await run.dispose()
  })
})
