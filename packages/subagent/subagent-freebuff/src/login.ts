import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

const SIGNED_OUT_FINDINGS: ReadonlySet<string> = new Set([
  'auth.signed-out',
  'auth.empty',
  'auth.corrupt',
  'auth.unreadable',
])
const DOCTOR_STDOUT_MAX_BYTES = 1_048_576
const DOCTOR_STDERR_MAX_BYTES = 4_096
const SHIM_VARIABLE = 'DSH_FREEBUFF_DOCTOR_EXE'

export interface LoginCheck {
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly executable: string
  readonly cwd: string
  readonly env: Record<string, string>
  readonly timeoutMs: number
  readonly graceMs: number
  readonly signal: AbortSignal
  readonly platform: NodeJS.Platform
  readonly comSpec: string | undefined
}

export interface DoctorCommand {
  readonly argv: string[]
  readonly env: Record<string, string>
}

export function doctorCommand(executable: string, platform: NodeJS.Platform, comSpec: string | undefined): DoctorCommand {
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)) {
    return {
      argv: [comSpec ?? 'cmd.exe', '/d', '/c', `%${SHIM_VARIABLE}%`, 'doctor', '--json'],
      env: { [SHIM_VARIABLE]: `"${executable}"` },
    }
  }
  return { argv: [executable, 'doctor', '--json'], env: {} }
}

export function freebuffLoginFailure(stdout: string): string | undefined {
  const start = stdout.indexOf('{')
  if (start < 0) return undefined
  let report: { findings?: unknown }
  try {
    report = JSON.parse(stdout.slice(start)) as { findings?: unknown }
  } catch (_notJson) {
    return undefined
  }
  if (!Array.isArray(report.findings)) return undefined
  for (const entry of report.findings as { id?: unknown }[]) {
    if (typeof entry.id === 'string' && SIGNED_OUT_FINDINGS.has(entry.id)) return entry.id
  }
  return undefined
}

export async function checkFreebuffLogin(check: LoginCheck): Promise<string | undefined> {
  let child: SubprocessHandle
  const doctor = doctorCommand(check.executable, check.platform, check.comSpec)
  try {
    child = check.spawn({
      argv: doctor.argv,
      cwd: check.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: DOCTOR_STDOUT_MAX_BYTES },
        stderr: { maxBytes: DOCTOR_STDERR_MAX_BYTES },
      },
      graceMs: check.graceMs,
      signal: AbortSignal.any([check.signal, AbortSignal.timeout(check.timeoutMs)]),
      env: { ...check.env, ...doctor.env },
    })
  } catch (_spawnFailed) {
    return undefined
  }
  try {
    await child.done
  } catch (_doctorFailed) {
    return undefined
  }
  return freebuffLoginFailure(child.collected.stdout?.readFrom(0).text ?? '')
}
