import { runInNewContext } from 'node:vm'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobHandle, JobHooks, JobOutcome } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { DshEnvironment, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** The firing condition: exactly one form. */
export type Until =
  | { readonly kind: 'exit-code'; readonly code: number }
  | { readonly kind: 'regex'; readonly pattern: RegExp }
  | { readonly kind: 'changed' }

/** A validated `watch` call, fixed when its job starts. */
export interface WatchPlan {
  readonly agent: Agent
  readonly command: string
  readonly until: Until
  readonly intervalMs: number
  readonly timeoutMs: number
  readonly maxConsecutiveErrors: number
  readonly dshEnv: DshEnvironment
}

const DEADLINE = Symbol('watch deadline')

const RESULT_TAIL_CHARS = 4000

const REGEX_BUDGET_MS = 250

type Check =
  | { readonly kind: 'ran'; readonly result: ShellRunResult }
  | { readonly kind: 'failed'; readonly message: string }

function clock(): string {
  return new Date().toTimeString().slice(0, 8)
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function tail(text: string): string {
  const trimmed = text.trimEnd()
  if (trimmed.length === 0) return '(no output)'
  return trimmed.length > RESULT_TAIL_CHARS ? `[earlier output dropped]\n${trimmed.slice(-RESULT_TAIL_CHARS)}` : trimmed
}

function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { settle(true) }, ms)
    function settle(elapsed: boolean): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(elapsed)
    }
    function onAbort(): void { settle(false) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function runCheck(ctx: Context, plan: WatchPlan, signal: AbortSignal): Promise<Check> {
  try {
    const policy = ctx.get('sandboxPolicy')?.resolve({ session: plan.agent.session })
    const workdir = policy?.workspaceRoot ?? plan.agent.session.header.cwd
    const execution = await ctx.shell.execute(ctx.shell.resolve({
      command: plan.command,
      ...workdir !== undefined ? { workdir } : {},
      dshEnv: plan.dshEnv,
      ...policy !== undefined ? { sandboxPolicy: policy } : {},
      signal,
    }))
    const result = await execution.result()
    if (result.timedOut) return { kind: 'failed', message: `the check exceeded its ${result.timeoutMs} ms deadline` }
    if (result.sandbox?.runnerFailed === true) return { kind: 'failed', message: 'the sandbox runner failed before the command ran' }
    return { kind: 'ran', result }
  } catch (error: unknown) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}

function matches(pattern: RegExp, text: string): boolean {
  try {
    return runInNewContext('pattern.test(text)', { pattern, text }, { timeout: REGEX_BUDGET_MS }) as boolean
  } catch (error: unknown) {
    if ((error as { code?: unknown }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new Error(`the regex /${pattern.source}/ took longer than ${REGEX_BUDGET_MS} ms on one check's output; use a simpler pattern`)
    }
    throw error
  }
}

function meets(until: Until, result: ShellRunResult, baseline: string | undefined): string | undefined {
  switch (until.kind) {
    case 'exit-code':
      return result.exitCode === until.code ? `condition met: exit code ${until.code}` : undefined
    case 'regex':
      return matches(until.pattern, result.stdout.text) ? `condition met: output matches /${until.pattern.source}/` : undefined
    case 'changed':
      return baseline !== undefined && result.stdout.text !== baseline ? 'condition met: output changed' : undefined
    default:
      return assertNever(until)
  }
}

async function watchUntilSettled(ctx: Context, plan: WatchPlan, job: JobHandle, signal: AbortSignal): Promise<JobOutcome> {
  let attempts = 0
  let failures = 0
  let baseline: string | undefined
  let last = ''
  while (true) {
    let check = await runCheck(ctx, plan, signal)
    if (signal.aborted) break
    attempts += 1
    let detail: string | undefined
    if (check.kind === 'ran') {
      try {
        detail = meets(plan.until, check.result, baseline)
      } catch (error: unknown) {
        check = { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
    }
    if (check.kind === 'failed') {
      failures += 1
      if (failures >= plan.maxConsecutiveErrors) {
        return { status: 'failed', detail: `stopped after ${failures} failed checks: ${oneLine(check.message)}` }
      }
      job.updateProgress(`check ${attempts} at ${clock()}: failed (${failures} in a row)`)
    } else {
      failures = 0
      const { result } = check
      baseline ??= result.stdout.text
      last = result.stdout.text
      if (detail !== undefined) {
        return { status: 'completed', detail, result: `Condition met after ${attempts} checks.\nLast output:\n${tail(last)}` }
      }
      job.updateProgress(`check ${attempts} at ${clock()}: exit ${result.exitCode ?? result.signal ?? 'unknown'}`)
    }
    const elapsed = await sleep(plan.intervalMs, signal)
    if (!elapsed) break
  }
  if (signal.reason === DEADLINE) {
    return {
      status: 'completed',
      detail: `timed out after ${Math.round(plan.timeoutMs / 60_000)} min without the condition`,
      result: `Condition not met before the timeout after ${attempts} checks.\nLast output:\n${tail(last)}`,
    }
  }
  return { status: 'killed' }
}

/**
 * Start one watch's check loop as a job's producer.
 * @param ctx - plugin context carrying `ctx.shell` and the optional sandbox policy.
 * @param plan - the validated watch call.
 * @param job - the job handle that receives the live progress line.
 * @returns job hooks whose `done` settles once and never rejects.
 */
export function startWatch(ctx: Context, plan: WatchPlan, job: JobHandle): JobHooks {
  const stop = new AbortController()
  const deadline = setTimeout(() => { stop.abort(DEADLINE) }, plan.timeoutMs)
  const done = watchUntilSettled(ctx, plan, job, stop.signal).finally(() => { clearTimeout(deadline) })
  return {
    cancel: () => { stop.abort() },
    done,
  }
}
