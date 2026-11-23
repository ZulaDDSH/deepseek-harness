import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationFlow, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { DoctorStatus } from './doctor.ts'
import { probeSignIn, type FreebuffEnvironment } from './environment.ts'
import { freebuffLaunch, stripAnsi } from './launch.ts'

export const PROVIDER = 'freebuff'
export const FREEBUFF_KEY = credentialKey('llm-freebuff', PROVIDER)

const URL_PATTERN = /https:\/\/[^\s"'<>\u001b]+(?=[\s"'<>])/
const OUTPUT_WINDOW = 65_536
const GRANT = { kind: 'grant', payload: { via: 'freebuff-cli' } } as const

export class FreebuffAccount {
  private cached: { readonly at: number, readonly status: DoctorStatus } | undefined
  private pending: Promise<DoctorStatus> | undefined

  constructor(private readonly ctx: Context, private readonly environment: FreebuffEnvironment) {}

  status(force = false): Promise<DoctorStatus> {
    if (!force && this.cached !== undefined && Date.now() - this.cached.at < this.environment.timing.doctorTtlMs) {
      return Promise.resolve(this.cached.status)
    }
    this.pending ??= probeSignIn(this.ctx, this.environment).then((status) => {
      if (status !== 'unknown') this.cached = { at: Date.now(), status }
      return status
    }).finally(() => { this.pending = undefined })
    return this.pending
  }

  async reconcile(force = false): Promise<DoctorStatus> {
    const status = await this.status(force)
    if (status === 'unknown') return status
    const { configured } = await this.ctx.credentials.describeRecord(FREEBUFF_KEY)
    if (status === 'signed-in' && !configured) {
      await this.ctx.credentials.modifyRecord(FREEBUFF_KEY, () => Promise.resolve(GRANT))
    } else if (status === 'signed-out' && configured && this.ctx.authorization.describe(FREEBUFF_KEY)?.inFlight !== true) {
      await this.ctx.credentials.deleteRecord(FREEBUFF_KEY)
    }
    return status
  }

  async signedOut(): Promise<void> {
    this.cached = { at: Date.now(), status: 'signed-out' }
    await this.reconcile()
  }

  flow(): AuthorizationFlow {
    return {
      key: FREEBUFF_KEY,
      label: 'Freebuff',
      methods: [{ id: 'cli', label: 'Sign in with Freebuff' }],
      run: session => this.login(session),
    }
  }

  private async login(session: AuthorizationSession): Promise<void> {
    const { environment } = this
    const executable = await environment.resolveExecutable(session.signal)
    const launch = freebuffLaunch(executable, [...environment.args, 'login'], environment.platform, environment.comSpec)
    const timeout = AbortSignal.timeout(environment.timing.loginTimeoutMs)
    const child = this.ctx.subprocess.spawn({
      argv: launch.argv,
      cwd: environment.homeDir,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: environment.timing.graceMs,
      signal: AbortSignal.any([session.signal, timeout]),
      env: { ...environment.env, ...launch.env },
    })
    let seen = ''
    let notified = false
    const onOutput = (chunk: Buffer | string): void => {
      if (notified) return
      seen = `${seen}${String(chunk)}`.slice(-OUTPUT_WINDOW)
      const url = URL_PATTERN.exec(stripAnsi(seen))?.[0]
      if (url === undefined) return
      notified = true
      session.notify({ message: 'Open this page to finish signing in', url })
    }
    child.stdout?.on('data', onOutput)
    child.stderr?.on('data', onOutput)
    const outcome = await child.done
    session.signal.throwIfAborted()
    if (timeout.aborted) throw new Error('llm-freebuff: Freebuff sign-in timed out')
    if (outcome.exitCode !== 0) throw new Error(`llm-freebuff: Freebuff sign-in failed (exit code ${String(outcome.exitCode)})`)
    if (await this.status(true) !== 'signed-in') throw new Error('llm-freebuff: Freebuff did not report a saved sign-in after login')
    await session.commit(GRANT)
  }
}
