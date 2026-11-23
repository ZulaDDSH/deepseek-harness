import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defaultEnvironment } from './environment.ts'
import { DEFAULT_IDLE_REAP_MS, PLUGIN_NAME, installFreebuff } from './install.ts'
import { defaultQuotaOptions } from './quota.ts'

export const name = PLUGIN_NAME
export const inject = ['authorization', 'credentials', 'llm', 'sessions', 'subprocess', 'workingDirectory']

export interface Config {
  readonly idleReapMs?: Volatile<number>
}

export const Config = z.object({
  idleReapMs: z.number().step(1).min(1_000).max(86_400_000).default(DEFAULT_IDLE_REAP_MS).volatile(),
})

export function apply(ctx: Context, config: Config): void {
  installFreebuff(ctx, config, {
    environment: defaultEnvironment(ctx),
    spawnTerminal: ctx.subprocess.spawnTerminal.bind(ctx.subprocess),
    quota: defaultQuotaOptions(),
  })
}
