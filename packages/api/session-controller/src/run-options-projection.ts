import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { SessionRunOptions, SessionRunOptionsProjection } from './types.ts'

const runOptionsSchema: z.ZodType<SessionRunOptions> = z.object({ fastMode: z.boolean().optional(), ultracode: z.boolean().optional() })
const stateSchema: z.ZodType<SessionRunOptionsProjection> = z.object({ current: runOptionsSchema.nullable() })

const runOptionsProjection = {
  key: 'runOptions',
  stateSchema,
  init: () => ({ current: null }),
  apply: (state, event: SessionEvent) => event.type === 'session/run-options'
    ? { current: { ...event.data } }
    : state,
  wire: { viewSchema: stateSchema, view: state => ({ current: state.current }) },
  stateVersion: 1,
} satisfies ProjectionDefinition<'runOptions', SessionRunOptionsProjection>

/**
 * Register the per-Session Claude Code run toggle projection.
 * @param ctx - application context that owns the Session projection registry.
 */
export function installRunOptionsProjection(ctx: Context): void {
  ctx.sessionProjections.register(runOptionsProjection)
}
