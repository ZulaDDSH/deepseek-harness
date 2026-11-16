import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { startWatch } from './poll.ts'
import type { Until, WatchPlan } from './poll.ts'

export const name = 'tool-watch'
export const inject = ['tools', 'shell', 'shellEnv', 'jobs', 'systemPrompt']

/** Deployment limits and defaults for `watch` calls. */
export interface Config {
  /** Smallest accepted `interval_s`, in seconds (default 30). */
  minIntervalSeconds?: number
  /** `interval_s` when a call omits it, in seconds (default 60). */
  defaultIntervalSeconds?: number
  /** `timeout_min` when a call omits it, in minutes (default 120). */
  defaultTimeoutMinutes?: number
  /** Largest accepted `timeout_min`, in minutes (default 1440). */
  maxTimeoutMinutes?: number
  /** Consecutive failed checks that end a watch as `failed` (default 3). */
  maxConsecutiveErrors?: number
}

const MAX_TIMEOUT_MINUTES = 35_791

export const Config: z<Config> = z.object({
  minIntervalSeconds: z.number().min(1).default(30),
  defaultIntervalSeconds: z.number().min(1).default(60),
  defaultTimeoutMinutes: z.number().min(1).max(MAX_TIMEOUT_MINUTES).default(120),
  maxTimeoutMinutes: z.number().min(1).max(MAX_TIMEOUT_MINUTES).default(1440),
  maxConsecutiveErrors: z.number().min(1).default(3),
})

interface UntilArgs {
  exit_code?: number
  regex?: string
  changed?: boolean
}

const DESCRIPTION = 'Wait for an external condition without polling. The host re-runs `command` at a fixed interval, with no model call in between, until `until` holds, `timeout_min` passes, or checks keep failing; then it wakes you with the outcome. '
  + 'Use it for any condition you would otherwise sleep or poll for: CI finishing, a pull request merging, a build or deploy completing, a file appearing, a service becoming reachable. '
  + 'Examples: `gh pr checks 123` with until {"exit_code": 0}; `gh pr view 123 --json state --jq .state` with until {"regex": "MERGED"}; `git ls-remote --exit-code origin my-branch` with until {"exit_code": 0} for a branch appearing; `curl -fsS https://example.com/health` with until {"exit_code": 0} in a POSIX shell. '
  + 'Start the watch, then end your turn; do not sleep or poll yourself. The command runs in the same shell as the shell tool, under this session\'s sandbox mode, and a watch never widens that mode. '
  + 'Use job_list and job_output to inspect a watch and job_kill to stop it. A watch lasts only while the host process runs.'

function parseUntil(until: UntilArgs): Until {
  const given = [until.exit_code, until.regex, until.changed].filter(value => value !== undefined).length
  if (given !== 1) throw new Error('invalid until: set exactly one of exit_code, regex, or changed')
  if (until.exit_code !== undefined) {
    if (!Number.isSafeInteger(until.exit_code)) throw new Error(`invalid until.exit_code: expected an integer, got ${until.exit_code}`)
    return { kind: 'exit-code', code: until.exit_code }
  }
  if (until.regex !== undefined) {
    if (until.regex.length === 0) throw new Error('invalid until.regex: expected a non-empty pattern')
    try {
      return { kind: 'regex', pattern: new RegExp(until.regex, 'm') }
    } catch (error: unknown) {
      throw new Error(`invalid until.regex: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (until.changed !== true) throw new Error('invalid until.changed: expected true')
  return { kind: 'changed' }
}

function checkInterval(seconds: number, minimum: number): number {
  if (!Number.isSafeInteger(seconds) || seconds < minimum) {
    throw new Error(`invalid interval_s: expected an integer of at least ${minimum}, got ${seconds}`)
  }
  return seconds
}

function checkTimeout(minutes: number, maximum: number): number {
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > maximum) {
    throw new Error(`invalid timeout_min: expected an integer from 1 to ${maximum}, got ${minutes}`)
  }
  return minutes
}

export function apply(ctx: Context, config: Config): void {
  const minIntervalSeconds = config.minIntervalSeconds ?? 30
  const defaultIntervalSeconds = config.defaultIntervalSeconds ?? 60
  const defaultTimeoutMinutes = config.defaultTimeoutMinutes ?? 120
  const maxTimeoutMinutes = config.maxTimeoutMinutes ?? 1440
  const maxConsecutiveErrors = config.maxConsecutiveErrors ?? 3
  if (defaultIntervalSeconds < minIntervalSeconds) {
    throw new Error(`tool-watch: defaultIntervalSeconds (${defaultIntervalSeconds}) is below minIntervalSeconds (${minIntervalSeconds})`)
  }
  if (defaultTimeoutMinutes > maxTimeoutMinutes) {
    throw new Error(`tool-watch: defaultTimeoutMinutes (${defaultTimeoutMinutes}) exceeds maxTimeoutMinutes (${maxTimeoutMinutes})`)
  }
  if (ctx.shell.sandboxMode !== undefined && ctx.get('sandboxPolicy') === undefined) {
    throw new Error('tool-watch: the mounted shell executor confines but ctx.sandboxPolicy is missing')
  }

  ctx.systemPrompt.section({
    name: 'tool:watch',
    order: ctx.systemPrompt.getSectionOrder('TOOL_JOBS'),
    text: 'To wait for an external condition, start a watch instead of sleeping or polling yourself, then end your turn: the watch wakes you when it fires, times out, or fails.',
  })

  ctx.tools.register(defineTool({
    name: 'watch',
    description: DESCRIPTION,
    parameters: {
      command: {
        type: 'string',
        required: true,
        description: 'Shell command re-run at every check, in the same shell as the shell tool. Its exit code and stdout are what `until` reads.',
      },
      label: {
        type: 'string',
        required: true,
        description: 'Short name for this watch, shown in job lists and in the wake-up notice.',
      },
      until: {
        type: 'object',
        required: true,
        description: 'The firing condition: set exactly one of exit_code, regex, or changed.',
        properties: {
          exit_code: { type: 'number', description: 'Fire when a check exits with this code, such as 0 for success.' },
          regex: { type: 'string', description: 'Fire when a check\'s stdout matches this JavaScript regular expression (multiline flag).' },
          changed: { type: 'boolean', description: 'Fire when a check\'s stdout differs from the first check\'s stdout. Only true is valid.' },
        },
        additionalProperties: false,
      },
      interval_s: {
        type: 'number',
        description: `Seconds from the end of one check to the start of the next: an integer of at least ${minIntervalSeconds} and no longer than the timeout. Defaults to ${defaultIntervalSeconds}.`,
      },
      timeout_min: {
        type: 'number',
        description: `Minutes before the watch stops without its condition: an integer from 1 to ${maxTimeoutMinutes}. Defaults to ${defaultTimeoutMinutes}.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          jobId: { type: 'string', required: true },
          label: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `started watch ${value.jobId} "${value.label}"; it wakes you when the condition holds, the timeout passes, or checks keep failing. Read the outcome with job_output.`,
      }],
    },
    execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('watch needs an owning agent: start it from an agent turn')
      if (args.command.trim().length === 0) throw new Error('invalid command: expected a non-empty string')
      if (args.label.trim().length === 0) throw new Error('invalid label: expected a non-empty string')
      const timeoutMs = checkTimeout(args.timeout_min ?? defaultTimeoutMinutes, maxTimeoutMinutes) * 60_000
      const intervalMs = checkInterval(args.interval_s ?? defaultIntervalSeconds, minIntervalSeconds) * 1000
      if (intervalMs > timeoutMs) {
        throw new Error(`invalid interval_s: ${intervalMs / 1000} s is longer than the ${timeoutMs / 60_000} min timeout, so only one check could run; lower interval_s or raise timeout_min`)
      }
      const plan: WatchPlan = {
        agent,
        command: args.command,
        until: parseUntil(args.until),
        intervalMs,
        timeoutMs,
        maxConsecutiveErrors,
        dshEnv: ctx.shellEnv.collect(exec),
      }
      const jobId = ctx.jobs.start({
        kind: 'watch',
        label: args.label,
        owner: agent.id,
        run: job => startWatch(ctx, plan, job),
      })
      return Promise.resolve({ jobId, label: args.label })
    },
    presentCall: (args): GenericCallView => ({ card: 'generic', title: args.label, kind: 'execute', rawInput: args.command }),
  }))
}
