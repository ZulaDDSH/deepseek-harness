import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { doctorStatus, type DoctorStatus } from './doctor.ts'
import { freebuffConfigDir } from './launch.ts'

export interface FreebuffTiming {
  readonly doctorTimeoutMs: number
  readonly doctorTtlMs: number
  readonly loginTimeoutMs: number
  readonly startupTimeoutMs: number
  readonly pollMs: number
  readonly pasteSettleMs: number
  readonly quietMs: number
  readonly interruptWaitMs: number
  readonly graceMs: number
  readonly maxTerminals: number
}

export const DEFAULT_TIMING: FreebuffTiming = {
  doctorTimeoutMs: 20_000,
  doctorTtlMs: 30_000,
  loginTimeoutMs: 900_000,
  startupTimeoutMs: 60_000,
  pollMs: 250,
  pasteSettleMs: 150,
  quietMs: 1_500,
  interruptWaitMs: 4_000,
  graceMs: 3_000,
  maxTerminals: 2,
}

export interface FreebuffEnvironment {
  readonly resolveExecutable: (signal?: AbortSignal) => Promise<string>
  readonly args: readonly string[]
  readonly env: Record<string, string>
  readonly configDir: string
  readonly homeDir: string
  readonly platform: NodeJS.Platform
  readonly comSpec: string | undefined
  readonly timing: FreebuffTiming
}

export function defaultEnvironment(ctx: Context): FreebuffEnvironment {
  return {
    resolveExecutable: async (signal) => {
      try {
        return await ctx.subprocess.resolveExecutable('freebuff', {}, signal)
      } catch (error: unknown) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new LlmError('The Freebuff CLI was not found. Install it and make `freebuff` resolvable on PATH.', 'INVALID_CONFIG', { cause: error })
        }
        throw error
      }
    },
    args: [],
    env: {},
    configDir: freebuffConfigDir(process.env),
    homeDir: homedir(),
    platform: process.platform,
    comSpec: process.env.ComSpec,
    timing: DEFAULT_TIMING,
  }
}

export async function probeSignIn(ctx: Context, environment: FreebuffEnvironment, signal?: AbortSignal): Promise<DoctorStatus> {
  let executable: string
  try {
    executable = await environment.resolveExecutable(signal)
  } catch (_missing) {
    return 'unknown'
  }
  return doctorStatus({
    spawn: spec => ctx.subprocess.spawn(spec),
    executable,
    args: environment.args,
    env: environment.env,
    cwd: environment.homeDir,
    platform: environment.platform,
    comSpec: environment.comSpec,
    timeoutMs: environment.timing.doctorTimeoutMs,
    graceMs: environment.timing.graceMs,
    signal,
  })
}
