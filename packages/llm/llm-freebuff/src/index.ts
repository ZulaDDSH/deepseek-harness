import type {} from '@deepseek-ai/dsh-api-quota-controller'
import type {} from '@deepseek-ai/dsh-settings'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { FreebuffAdapter } from './adapter.ts'
import { FreebuffAccount, PROVIDER } from './auth.ts'
import { defaultEnvironment, type FreebuffEnvironment } from './environment.ts'
import { createFreebuffQuotaSource, defaultQuotaOptions, type FreebuffQuotaOptions } from './quota.ts'
import { FreebuffPool } from './session.ts'

export { FreebuffAdapter, MODEL_ID, promptOf, resumeOf, type FreebuffReplay } from './adapter.ts'
export { FREEBUFF_KEY, FreebuffAccount, PROVIDER } from './auth.ts'
export { doctorFindings, doctorStatus, type DoctorStatus } from './doctor.ts'
export { DEFAULT_TIMING, defaultEnvironment, type FreebuffEnvironment, type FreebuffTiming } from './environment.ts'
export { freebuffLaunch } from './launch.ts'
export { renderBlocks } from './markdown.ts'
export { createFreebuffQuotaSource, defaultQuotaOptions, type FreebuffQuotaOptions } from './quota.ts'
export { FreebuffPool } from './session.ts'

export const name = 'llm-freebuff'
export const inject = ['authorization', 'credentials', 'llm', 'sessions', 'subprocess', 'workingDirectory']

export const DEFAULT_IDLE_REAP_MS = 600_000

export interface Config {
  readonly idleReapMs?: Volatile<number>
}

export const Config = z.object({
  idleReapMs: z.number().step(1).min(1_000).max(86_400_000).default(DEFAULT_IDLE_REAP_MS).volatile(),
})

export interface FreebuffWiring {
  readonly environment: FreebuffEnvironment
  readonly spawnTerminal: (spec: SubprocessTerminalSpawnSpec) => Promise<SubprocessTerminalHandle>
  readonly quota?: FreebuffQuotaOptions
}

export function installFreebuff(ctx: Context, config: Config, wiring: FreebuffWiring): FreebuffPool {
  const account = new FreebuffAccount(ctx, wiring.environment)
  const pool = new FreebuffPool({
    environment: wiring.environment,
    account,
    spawnTerminal: wiring.spawnTerminal,
    idleReapMs: () => config.idleReapMs?.get() ?? DEFAULT_IDLE_REAP_MS,
  })
  ctx.authorization.registerFlow(account.flow())
  ctx.llm.registerAdapter([PROVIDER], new FreebuffAdapter(ctx, pool, account))
  ctx.llm.registerConfigurableProviders([{
    provider: PROVIDER,
    displayName: 'Freebuff',
    settingsNs: ctx.fiber.entry?.options.id ?? name,
    settingsPath: [],
    nativeAuth: { env: [], oauth: true },
  }])
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  const quota = wiring.quota
  if (quota !== undefined) ctx.inject(['quotaController'], child => child.effect(() => child.quotaController.registerSource(createFreebuffQuotaSource(quota))))
  ctx.effect(() => () => { pool.dispose().catch(() => {}) }, 'llm-freebuff.pool')
  account.reconcile().catch(() => {})
  return pool
}

export function apply(ctx: Context, config: Config): void {
  installFreebuff(ctx, config, {
    environment: defaultEnvironment(ctx),
    spawnTerminal: spec => ctx.subprocess.spawnTerminal(spec),
    quota: defaultQuotaOptions(),
  })
}
