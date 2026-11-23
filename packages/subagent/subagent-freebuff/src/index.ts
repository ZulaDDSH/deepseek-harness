import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  assertPositiveFinite,
  assertUsableCwd,
  NO_START_CAPABILITIES,
  resolveParentSandboxMode,
  SubagentError,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { FreebuffNotInstalledError, FreebuffNotLoggedInError, FreebuffRunFailure } from './errors.ts'
import { checkFreebuffLogin } from './login.ts'
import {
  DEFAULT_DISPOSE_GRACE_MS,
  DEFAULT_IDLE_MS,
  DEFAULT_STARTUP_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  startFreebuffRun,
  type FreebuffRunSpec,
} from './run.ts'
import { freebuffConfigDir } from './transcript.ts'

export {
  FREEBUFF_LOGIN_COMMAND,
  FreebuffNotInstalledError,
  FreebuffNotLoggedInError,
  FreebuffRunFailure,
} from './errors.ts'

export const name = 'subagent-freebuff'
export const inject = ['subagents', 'subprocess']

const DEFAULT_PROVIDER_NAME = 'freebuff'
const DEFAULT_EXECUTABLE = 'freebuff'
const PREFIX = 'subagent-freebuff'

export interface Config {
  providerName?: string
  executable?: string
  cwd?: string
  args?: string[]
  env?: Record<string, string>
  trustAgents?: boolean
  loginCheck?: boolean
  startupTimeoutMs?: number
  idleMs?: number
  timeoutMs?: number
  disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  executable: z.string().min(1).default(DEFAULT_EXECUTABLE),
  cwd: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.dict(z.string()).default({}),
  trustAgents: z.boolean().default(false),
  loginCheck: z.boolean().default(true),
  startupTimeoutMs: z.number().default(DEFAULT_STARTUP_TIMEOUT_MS),
  idleMs: z.number().default(DEFAULT_IDLE_MS),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

type ResolvedConfig = Omit<Required<Config>, 'cwd'> & Pick<Config, 'cwd'>

class FreebuffProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  async start(request: ResolvedSubagentStartRequest) {
    const cwd = assertUsableCwd(PREFIX, 'child cwd', this.config.cwd ?? request.cwd)
    if (request.signal.aborted) throw new Error(`${PREFIX}: request was aborted before startup`)
    const parentSandbox = resolveParentSandboxMode(this.ctx, request.parent.session)
    if (parentSandbox !== undefined && parentSandbox !== 'danger-full-access') {
      throw new SubagentError(
        `${PREFIX}: Freebuff cannot be confined to a sandbox and requires a danger-full-access parent session; the parent session is ${parentSandbox}`,
        'PARENT_SANDBOX_MISMATCH',
      )
    }
    const { subprocess, logger } = this.ctx
    let executable: string
    try {
      executable = await subprocess.resolveExecutable(this.config.executable, this.config.env, request.signal)
    } catch (error: unknown) {
      throw error instanceof SubprocessExecutableNotFoundError
        ? new FreebuffNotInstalledError(this.config.executable, { cause: error })
        : error
    }
    if (this.config.loginCheck) {
      const reason = await checkFreebuffLogin({
        spawn: spec => subprocess.spawn(spec),
        executable,
        cwd,
        env: this.config.env,
        timeoutMs: this.config.startupTimeoutMs,
        graceMs: this.config.disposeGraceMs,
        signal: request.signal,
        platform: process.platform,
        comSpec: process.env.ComSpec,
      })
      if (reason !== undefined) throw new FreebuffNotLoggedInError(`doctor: ${reason}`)
      if (request.signal.aborted) throw new Error(`${PREFIX}: request was aborted before startup`)
    }
    const spec: FreebuffRunSpec = {
      cwd,
      executable,
      args: this.config.args,
      env: this.config.env,
      trustAgents: this.config.trustAgents,
      startupTimeoutMs: this.config.startupTimeoutMs,
      idleMs: this.config.idleMs,
      timeoutMs: this.config.timeoutMs,
      disposeGraceMs: this.config.disposeGraceMs,
      configDir: freebuffConfigDir({ ...process.env, ...this.config.env }),
      spawnTerminal: terminalSpec => subprocess.spawnTerminal(terminalSpec),
      onError: (error, stopReason) => {
        const tail = error instanceof FreebuffRunFailure && error.screenTail !== undefined
          ? `\n${error.screenTail}`
          : ''
        logger.warn(`${PREFIX} "${this.name}": child run failed (${stopReason}): ${error.message}${tail}`)
      },
    }
    return startFreebuffRun(request, spec)
  }
}

function assertTimer(field: string, value: number): void {
  assertPositiveFinite(PREFIX, field, value)
  if (value > MAX_TIMER_DELAY_MS) {
    throw new Error(`${PREFIX}: ${field} must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    executable: config.executable ?? DEFAULT_EXECUTABLE,
    ...config.cwd === undefined ? {} : { cwd: config.cwd },
    args: config.args ?? [],
    env: config.env ?? {},
    trustAgents: config.trustAgents ?? false,
    loginCheck: config.loginCheck ?? true,
    startupTimeoutMs: config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    idleMs: config.idleMs ?? DEFAULT_IDLE_MS,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    disposeGraceMs: config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
  }
  assertTimer('startupTimeoutMs', resolved.startupTimeoutMs)
  assertTimer('idleMs', resolved.idleMs)
  assertTimer('timeoutMs', resolved.timeoutMs)
  assertTimer('disposeGraceMs', resolved.disposeGraceMs)
  ctx.subagents.registerProvider(new FreebuffProvider(resolved.providerName, ctx, resolved))
}
