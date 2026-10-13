import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk'
import type { SessionRunOptions, SessionRunOptionsProjection } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

const CLAUDE_CODE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly EffortLevel[]

const runOptionsSchema: z.ZodType<SessionRunOptions> = z.object({
  fastMode: z.boolean().optional(),
  ultracode: z.boolean().optional(),
  effort: z.enum(CLAUDE_CODE_EFFORTS).optional(),
})
const stateSchema: z.ZodType<SessionRunOptionsProjection> = z.object({ current: runOptionsSchema.nullable() })

/** Per-Session Claude Code run options projection; only an installed Claude Code provider registers it. */
export const runOptionsProjection = {
  key: 'runOptions',
  stateSchema,
  init: () => ({ current: null }),
  apply: (state, event: SessionEvent) => event.type === 'session/run-options'
    ? { current: { ...event.data } }
    : state,
  wire: { viewSchema: stateSchema, view: state => ({ current: state.current }) },
  stateVersion: 1,
} satisfies ProjectionDefinition<'runOptions', SessionRunOptionsProjection>
