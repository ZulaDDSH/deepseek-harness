import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { HookOverrides, HookOverridesProjection } from './types.ts'

const overridesSchema: z.ZodType<HookOverrides> = z.object({ overrides: z.record(z.string(), z.boolean()) })
const stateSchema: z.ZodType<HookOverridesProjection> = z.object({ current: overridesSchema.nullable() })

const hookOverridesProjection = {
  key: 'hookOverrides',
  stateSchema,
  init: () => ({ current: null }),
  apply: (state, event: SessionEvent) => event.type === 'hooks/session-overrides'
    ? { current: { overrides: { ...event.data.overrides } } }
    : state,
  wire: { viewSchema: stateSchema, view: state => ({ current: state.current }) },
  stateVersion: 1,
} satisfies ProjectionDefinition<'hookOverrides', HookOverridesProjection>

/**
 * Register the per-Session hook override projection.
 * @param ctx - application context that owns the Session projection registry.
 */
export function installHookOverridesProjection(ctx: Context): void {
  ctx.sessionProjections.register(hookOverridesProjection)
}
