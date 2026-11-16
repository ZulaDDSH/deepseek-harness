import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { JobId } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellExecution, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import * as ShellEnvPlugin from '@deepseek-ai/dsh-shell-env'
import * as ToolWatch from '../src/index.ts'

const silentReader = { readFrom: (fromByte: number) => ({ text: '', nextOffset: fromByte, lossy: false }) }

interface Step {
  exit?: number
  stdout?: string
  timedOut?: boolean
  runnerFailed?: boolean
  prepareError?: string
  resultError?: Error
}

function scriptedShell(steps: Step[], sandboxMode?: SandboxMode) {
  const requests: ShellExecRequest[] = []
  let executed = 0
  class ScriptedShell extends ShellExecutor {
    override get sandboxMode(): SandboxMode | undefined {
      return sandboxMode
    }

    resolve(request: ShellExecRequest): ShellExecSpec {
      requests.push(request)
      return {
        command: request.command,
        workdir: request.workdir ?? '/workspace',
        timeoutMs: request.timeoutMs ?? 1000,
        onExpiry: 'kill',
        stdoutMaxBytes: 64_000,
        ...request.signal ? { signal: request.signal } : {},
        ...request.dshEnv ? { dshEnv: request.dshEnv } : {},
        sandboxPolicy: request.sandboxPolicy,
      }
    }

    async execute(spec: ShellExecSpec): Promise<ShellExecution> {
      const step: Step = steps[Math.min(executed, steps.length - 1)] ?? {}
      executed += 1
      if (step.prepareError !== undefined) throw new Error(step.prepareError)
      const result: ShellRunResult = {
        exitCode: step.exit ?? 0,
        signal: null,
        timedOut: step.timedOut === true,
        aborted: false,
        timeoutMs: spec.timeoutMs,
        stdout: { text: step.stdout ?? '', truncated: false },
        stderr: { text: '', truncated: false },
        ...step.runnerFailed === true ? { sandbox: { mode: 'workspace-write', denied: false, runnerFailed: true } } : {},
      }
      return {
        status: 'completed',
        exitCode: result.exitCode,
        signal: null,
        done: Promise.resolve(),
        readOutput: () => ({ delta: '', lossy: false }),
        observed: { stdout: silentReader, stderr: silentReader },
        kill: () => false,
        result: () => step.resultError !== undefined ? Promise.reject(step.resultError) : Promise.resolve(result),
      }
    }
  }
  return { Shell: ScriptedShell, requests, calls: () => executed }
}

const policyState = { mode: 'workspace-write' as SandboxMode }

class PolicyStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sandboxPolicy')
  }

  resolve() {
    return { mode: policyState.mode, workspaceRoot: '/workspace' }
  }
}

interface Setup {
  steps?: Step[]
  sandboxMode?: SandboxMode
  policy?: boolean
  config?: ToolWatch.Config
}

async function setup(options: Setup = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalJobRegistry, {})
  await ctx.plugin(ToolJobs, {})
  await ctx.plugin(ShellEnvPlugin)
  const shell = scriptedShell(options.steps ?? [{ exit: 1 }], options.sandboxMode)
  await ctx.plugin(shell.Shell)
  if (options.policy === true) await ctx.plugin(PolicyStub)
  await ctx.plugin(ToolWatch, options.config ?? {})
  return { ctx, shell }
}

interface Owner {
  readonly agent: Agent
  readonly followups: UserMessage[]
  readonly injects: UserMessage[]
}

type FakeAgent = Pick<Agent, 'id' | 'ctx' | 'inbox' | 'inject' | 'followup' | 'status'> & {
  readonly session: Pick<Agent['session'], 'id' | 'header'>
}

async function fakeOwner(ctx: Context, id: string, status: 'idle' | 'running', cwd?: string): Promise<Owner> {
  const followups: UserMessage[] = []
  const injects: UserMessage[] = []
  const sessionId = SessionId(id)
  const scope = ctx.plugin(() => {})
  const fake: FakeAgent = {
    id: sessionId,
    ctx: scope.ctx,
    inbox: { remove: () => false } as never,
    inject: (message: UserMessage) => { injects.push(message) },
    followup: (message: UserMessage) => { followups.push(message) },
    status,
    session: {
      id: sessionId,
      header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, isSeeded: false, ...cwd !== undefined ? { cwd } : {} },
    },
  }
  const agent = fake as Agent
  await ctx.agents.register(agent)
  return { agent, followups, injects }
}

let callCounter = 0
async function call(ctx: Context, name: string, args: unknown, agent?: Agent) {
  const batch = await ctx.tools.execute({
    signal: new AbortController().signal,
    calls: [{ type: 'tool-call', id: ToolCallId(`call-${++callCounter}`), name, arguments: JSON.stringify(args) }],
    ...agent ? { agent } : {},
  })
  return batch.results[0]!.result
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function messageText(message: UserMessage): string {
  return message.content.map(block => (block.type === 'text' ? block.text : '')).join('')
}

function jobIdOf(ctx: Context, owner: Owner, index = 0): JobId {
  return ctx.jobs.list(owner.agent.id)[index]!.id
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await new Promise<void>(resolve => setImmediate(resolve))
}

const base = { command: 'ci-check', label: 'CI on PR 123', until: { exit_code: 0 }, interval_s: 30 }

describe('watch tool', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    policyState.mode = 'workspace-write'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires on exit code and wakes an idle owner once after the last check', async () => {
    const { ctx, shell } = await setup({ steps: [{ exit: 1 }, { exit: 1 }, { exit: 0 }] })
    const owner = await fakeOwner(ctx, 'alice', 'idle')
    const started = await call(ctx, 'watch', base, owner.agent)
    expect(started.isError).toBe(false)
    expect(text(started)).toContain(`started watch ${jobIdOf(ctx, owner)} "CI on PR 123"`)
    await advance(0)
    expect(shell.calls()).toBe(1)
    await advance(30_000)
    expect(shell.calls()).toBe(2)
    expect(owner.followups).toHaveLength(0)
    await advance(30_000)
    expect(shell.calls()).toBe(3)
    expect(ctx.jobs.get(jobIdOf(ctx, owner), owner.agent.id).detail).toBe('condition met: exit code 0')
    expect(vi.getTimerCount()).toBe(0)
    expect(owner.followups).toHaveLength(1)
    expect(owner.injects).toHaveLength(0)
    expect(messageText(owner.followups[0]!)).toContain(`background job ${jobIdOf(ctx, owner)} (watch: CI on PR 123)`)
  })

  it('delivers the settlement into a busy owner at its next step instead of waking it', async () => {
    const { ctx } = await setup({ steps: [{ exit: 0 }] })
    const owner = await fakeOwner(ctx, 'bob', 'running')
    await call(ctx, 'watch', base, owner.agent)
    await advance(0)
    expect(owner.followups).toHaveLength(0)
    expect(owner.injects).toHaveLength(1)
    expect(messageText(owner.injects[0]!)).toContain(`background job ${jobIdOf(ctx, owner)}`)
  })

  it('fires on a regex match and reports the matched output through job_output', async () => {
    const { ctx } = await setup({ steps: [{ exit: 0, stdout: 'state: OPEN\n' }, { exit: 0, stdout: 'state: MERGED\n' }] })
    const owner = await fakeOwner(ctx, 'carol', 'running')
    await call(ctx, 'watch', { ...base, until: { regex: '^state: MERGED$' } }, owner.agent)
    await advance(0)
    await advance(30_000)
    expect(ctx.jobs.get(jobIdOf(ctx, owner), owner.agent.id).detail).toBe('condition met: output matches /^state: MERGED$/')
    const read = await call(ctx, 'job_output', { job_id: jobIdOf(ctx, owner) }, owner.agent)
    expect(text(read)).toContain('Condition met after 2 checks.')
    expect(text(read)).toContain('state: MERGED')
  })

  it('fires on changed output only after the first check has set the baseline', async () => {
    const { ctx, shell } = await setup({ steps: [{ stdout: 'a' }, { stdout: 'a' }, { stdout: 'b' }] })
    const owner = await fakeOwner(ctx, 'dave', 'running')
    await call(ctx, 'watch', { ...base, until: { changed: true } }, owner.agent)
    await advance(0)
    await advance(30_000)
    expect(shell.calls()).toBe(2)
    expect(ctx.jobs.list(owner.agent.id)[0]?.status).toBe('running')
    await advance(30_000)
    expect(ctx.jobs.get(jobIdOf(ctx, owner), owner.agent.id).detail).toBe('condition met: output changed')
  })

  it('settles completed at its deadline when the condition never holds', async () => {
    const { ctx } = await setup({ steps: [{ exit: 1 }] })
    const owner = await fakeOwner(ctx, 'erin', 'idle')
    await call(ctx, 'watch', { ...base, timeout_min: 1 }, owner.agent)
    await advance(0)
    await advance(60_000)
    const job = ctx.jobs.get(jobIdOf(ctx, owner), owner.agent.id)
    expect(job.status).toBe('completed')
    expect(job.detail).toBe('timed out after 1 min without the condition')
    expect(owner.followups).toHaveLength(1)
  })

  it('stops after the failure limit for timed-out, sandbox-failed, and thrown checks alike', async () => {
    const { ctx } = await setup({
      steps: [{ timedOut: true }, { runnerFailed: true }, { resultError: new Error('stream lost') }],
    })
    const owner = await fakeOwner(ctx, 'frank', 'idle')
    await call(ctx, 'watch', base, owner.agent)
    await advance(0)
    await advance(30_000)
    await advance(30_000)
    const job = ctx.jobs.get(jobIdOf(ctx, owner), owner.agent.id)
    expect(job.status).toBe('failed')
    expect(job.detail).toBe('stopped after 3 failed checks: stream lost')
    expect(owner.followups).toHaveLength(1)
  })

  it('fails a check whose regex backtracks catastrophically instead of hanging the host', async () => {
    const { ctx } = await setup({ steps: [{ exit: 0, stdout: `${'a'.repeat(60)}b` }] })
    const owner = await fakeOwner(ctx, 'ravi', 'idle')
    await call(ctx, 'watch', { ...base, until: { regex: '(a+)+$' } }, owner.agent)
    await advance(0)
    await advance(30_000)
    await advance(30_000)
    const job = ctx.jobs.get(jobIdOf(ctx, owner), owner.agent.id)
    expect(job.status).toBe('failed')
    expect(job.detail).toContain('took longer than 250 ms')
    expect(owner.followups).toHaveLength(1)
  }, 15_000)

  it('resets the failure count after a completed check', async () => {
    const { ctx } = await setup({
      steps: [{ prepareError: 'down' }, { prepareError: 'down' }, { exit: 1 }, { prepareError: 'down' }],
    })
    const owner = await fakeOwner(ctx, 'gina', 'idle')
    await call(ctx, 'watch', base, owner.agent)
    await advance(0)
    for (let i = 0; i < 3; i += 1) await advance(30_000)
    expect(ctx.jobs.get(jobIdOf(ctx, owner), owner.agent.id).status).toBe('running')
  })

  it('polls without calling the owning agent until the condition holds', async () => {
    const { ctx, shell } = await setup({ steps: [{ exit: 1 }] })
    const owner = await fakeOwner(ctx, 'hank', 'idle')
    await call(ctx, 'watch', base, owner.agent)
    await advance(0)
    for (let i = 0; i < 4; i += 1) await advance(30_000)
    expect(shell.calls()).toBe(5)
    expect(owner.followups).toHaveLength(0)
    expect(owner.injects).toHaveLength(0)
    expect(ctx.jobs.get(jobIdOf(ctx, owner), owner.agent.id).status).toBe('running')
  })

  it('stops polling on cancel and settles killed with the kill reason', async () => {
    const { ctx, shell } = await setup({ steps: [{ exit: 1 }] })
    const owner = await fakeOwner(ctx, 'ivy', 'running')
    await call(ctx, 'watch', base, owner.agent)
    await advance(0)
    expect(ctx.jobs.kill(jobIdOf(ctx, owner), owner.agent.id, 'no longer needed')).toBe('requested')
    await advance(120_000)
    expect(shell.calls()).toBe(1)
    const job = ctx.jobs.get(jobIdOf(ctx, owner), owner.agent.id)
    expect(job.status).toBe('killed')
    expect(job.detail).toBe('no longer needed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resolves the session sandbox policy at each check and never sends an escalated request', async () => {
    const { ctx, shell } = await setup({ steps: [{ exit: 1 }, { exit: 0 }], sandboxMode: 'workspace-write', policy: true })
    const owner = await fakeOwner(ctx, 'jo', 'running')
    await call(ctx, 'watch', base, owner.agent)
    await advance(0)
    policyState.mode = 'read-only'
    await advance(30_000)
    expect(shell.calls()).toBe(2)
    expect(shell.requests.map(request => request.sandboxPolicy?.mode)).toEqual(['workspace-write', 'read-only'])
    expect(shell.requests.map(request => request.workdir)).toEqual(['/workspace', '/workspace'])
    expect(shell.requests.every(request => request.dshEnv !== undefined)).toBe(true)
  })

  it('runs checks in the session cwd when no sandbox policy supplies one', async () => {
    const { ctx, shell } = await setup({ steps: [{ exit: 0 }] })
    const owner = await fakeOwner(ctx, 'kim', 'running', '/repo')
    await call(ctx, 'watch', base, owner.agent)
    await advance(0)
    expect(shell.requests[0]?.workdir).toBe('/repo')
    expect(shell.requests[0]?.sandboxPolicy).toBeUndefined()
  })

  it('keeps only the tail of long output in the job result', async () => {
    const { ctx } = await setup({ steps: [{ exit: 0, stdout: 'x'.repeat(5000) }] })
    const owner = await fakeOwner(ctx, 'lee', 'running')
    await call(ctx, 'watch', base, owner.agent)
    await advance(0)
    const read = await call(ctx, 'job_output', { job_id: jobIdOf(ctx, owner) }, owner.agent)
    expect(text(read)).toContain('[earlier output dropped]')
  })

  it('marks a check with no output as having no output', async () => {
    const { ctx } = await setup({ steps: [{ exit: 0 }] })
    const owner = await fakeOwner(ctx, 'mia', 'running')
    await call(ctx, 'watch', base, owner.agent)
    await advance(0)
    const read = await call(ctx, 'job_output', { job_id: jobIdOf(ctx, owner) }, owner.agent)
    expect(text(read)).toContain('(no output)')
  })

  it('starts several watches per owner as independent jobs', async () => {
    const { ctx } = await setup({ steps: [{ exit: 0 }] })
    const owner = await fakeOwner(ctx, 'nina', 'running')
    await call(ctx, 'watch', base, owner.agent)
    await call(ctx, 'watch', { ...base, label: 'deploy' }, owner.agent)
    await advance(0)
    expect(new Set(ctx.jobs.list(owner.agent.id).map(job => job.id)).size).toBe(2)
    expect(owner.injects.map(message => messageText(message))).toEqual([
      expect.stringContaining(jobIdOf(ctx, owner, 0)),
      expect.stringContaining(jobIdOf(ctx, owner, 1)),
    ])
  })

  it('rejects invalid until, interval, timeout, command, and label before starting a job', async () => {
    const { ctx } = await setup()
    const owner = await fakeOwner(ctx, 'omar', 'idle')
    const invalid: Record<string, unknown>[] = [
      { ...base, until: {} },
      { ...base, until: { exit_code: 0, changed: true } },
      { ...base, until: { exit_code: 1.5 } },
      { ...base, until: { regex: '' } },
      { ...base, until: { regex: '(' } },
      { ...base, until: { changed: false } },
      { ...base, interval_s: 10 },
      { ...base, interval_s: 60.5 },
      { ...base, timeout_min: 0 },
      { ...base, timeout_min: 2000 },
      { ...base, timeout_min: 1.5 },
      { ...base, interval_s: 120, timeout_min: 1 },
      { ...base, interval_s: 1e9 },
      { ...base, command: '   ' },
      { ...base, label: ' ' },
    ]
    for (const args of invalid) {
      expect((await call(ctx, 'watch', args, owner.agent)).isError).toBe(true)
    }
    expect(ctx.jobs.list(owner.agent.id)).toEqual([])
  })

  it('refuses a call without an owning agent', async () => {
    const { ctx } = await setup()
    expect((await call(ctx, 'watch', base)).isError).toBe(true)
  })

  it('applies the default interval and timeout when the call omits them', async () => {
    const { ctx, shell } = await setup({ steps: [{ exit: 1 }] })
    const owner = await fakeOwner(ctx, 'pat', 'running')
    await call(ctx, 'watch', { command: 'ci-check', label: 'defaults', until: { exit_code: 0 } }, owner.agent)
    await advance(0)
    await advance(59_000)
    expect(shell.calls()).toBe(1)
    await advance(1000)
    expect(shell.calls()).toBe(2)
    await advance(120 * 60_000)
    expect(ctx.jobs.get(jobIdOf(ctx, owner), owner.agent.id).detail).toBe('timed out after 120 min without the condition')
  })

  it('renders a generic card with the label as title and the command as raw input', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.get('watch')?.presentCall?.(base)).toEqual({
      card: 'generic',
      title: 'CI on PR 123',
      kind: 'execute',
      rawInput: 'ci-check',
    })
  })

  it('rejects a config whose default interval is below its minimum', async () => {
    await expect(setup({ config: { minIntervalSeconds: 60, defaultIntervalSeconds: 30 } }))
      .rejects.toThrow('defaultIntervalSeconds (30) is below minIntervalSeconds (60)')
  })

  it('rejects a config whose timeout cap exceeds what a timer can hold', async () => {
    await expect(setup({ config: { maxTimeoutMinutes: 40_000 } })).rejects.toThrow()
  })

  it('rejects a config whose default timeout exceeds its maximum', async () => {
    await expect(setup({ config: { defaultTimeoutMinutes: 2000, maxTimeoutMinutes: 1440 } }))
      .rejects.toThrow('defaultTimeoutMinutes (2000) exceeds maxTimeoutMinutes (1440)')
  })

  it('refuses to load over a confining shell without a sandbox policy', async () => {
    await expect(setup({ sandboxMode: 'workspace-write' }))
      .rejects.toThrow('confines but ctx.sandboxPolicy is missing')
  })
})
