import type {} from '@deepseek-ai/dsh-api-quota-controller'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { FreebuffAdapter } from './adapter.ts'
import { FreebuffAccount, PROVIDER } from './auth.ts'
import type { FreebuffEnvironment } from './environment.ts'
import type { Config } from './index.ts'
import { createFreebuffQuotaSource, type FreebuffQuotaOptions } from './quota.ts'
import { FreebuffPool } from './session.ts'

export const PLUGIN_NAME = 'llm-freebuff'
export const DEFAULT_IDLE_REAP_MS = 600_000

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
    settingsNs: ctx.fiber.entry?.options.id ?? PLUGIN_NAME,
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
