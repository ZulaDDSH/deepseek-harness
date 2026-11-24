import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { freebuffLaunch } from './launch.ts'

const SIGNED_OUT_FINDINGS: ReadonlySet<string> = new Set(['auth.signed-out', 'auth.empty', 'auth.corrupt', 'auth.unreadable'])
const SIGNED_IN_FINDING = 'auth.ok'
const STDOUT_MAX_BYTES = 1_048_576
const STDERR_MAX_BYTES = 4_096

export type DoctorStatus = 'signed-in' | 'signed-out' | 'unknown'

export interface DoctorRun {
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly executable: string
  readonly args: readonly string[]
  readonly env: Record<string, string>
  readonly cwd: string
  readonly platform: NodeJS.Platform
  readonly comSpec: string | undefined
  readonly timeoutMs: number
  readonly graceMs: number
  readonly signal?: AbortSignal | undefined
}

export function doctorFindings(stdout: string): DoctorStatus {
  const start = stdout.indexOf('{')
  if (start < 0) return 'unknown'
  let report: { findings?: unknown }
  try {
    report = JSON.parse(stdout.slice(start)) as { findings?: unknown }
  } catch (_notJson) {
    return 'unknown'
  }
  if (!Array.isArray(report.findings)) return 'unknown'
  const ids = (report.findings as { id?: unknown }[]).map(finding => finding.id)
  if (ids.some(id => typeof id === 'string' && SIGNED_OUT_FINDINGS.has(id))) return 'signed-out'
  return ids.includes(SIGNED_IN_FINDING) ? 'signed-in' : 'unknown'
}

export async function doctorStatus(run: DoctorRun): Promise<DoctorStatus> {
  try {
    const launch = freebuffLaunch(run.executable, [...run.args, 'doctor', '--json'], run.platform, run.comSpec)
    const child = run.spawn({
      argv: launch.argv,
      cwd: run.cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: STDOUT_MAX_BYTES }, stderr: { maxBytes: STDERR_MAX_BYTES } },
      graceMs: run.graceMs,
      signal: AbortSignal.any([...run.signal === undefined ? [] : [run.signal], AbortSignal.timeout(run.timeoutMs)]),
      env: { ...run.env, ...launch.env },
    })
    await child.done
    return doctorFindings(child.collected.stdout?.readFrom(0).text ?? '')
  } catch (_doctorFailed) {
    return 'unknown'
  }
}
