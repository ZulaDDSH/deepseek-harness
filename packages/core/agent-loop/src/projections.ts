/** Host projections the agent loop reads to decide turn boundaries and turn eligibility. */
import { z as zod } from 'zod'
import type { CliTerminalProjection, TurnBoundaryProjection } from '@deepseek-ai/dsh-agent'
import { CLI_TERMINAL_PROFILE_IDS, SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

const turnBoundaryProjectionSchema: zod.ZodType<TurnBoundaryProjection> = zod.object({
  openTurnStartSeq: zod.number().int().nonnegative().transform(SessionSeq).nullable(),
  lastStepStartSeq: zod.number().int().nonnegative().transform(SessionSeq).nullable(),
  lastStepBoundary: zod.object({
    kind: zod.union([zod.literal('start'), zod.literal('end')]),
    seq: zod.number().int().nonnegative().transform(SessionSeq),
  }).nullable(),
  lastTurn: zod.number().int().nonnegative(),
})

/** Host projection of agent turn and step boundaries. */
export const turnBoundaryProjectionDefinition = {
  key: 'turnBoundary',
  stateVersion: 2,
  stateSchema: turnBoundaryProjectionSchema,
  init: () => ({
    openTurnStartSeq: null,
    lastStepStartSeq: null,
    lastStepBoundary: null,
    lastTurn: 0,
  }),
  apply: (state, event) => {
    switch (event.type) {
      case 'turn/start':
        return {
          ...state,
          openTurnStartSeq: event.seq,
          lastTurn: event.data.turn,
        }
      case 'turn/end':
        return {
          ...state,
          openTurnStartSeq: null,
        }
      case 'step/start':
        return {
          ...state,
          lastStepStartSeq: event.seq,
          lastStepBoundary: { kind: 'start', seq: event.seq },
        }
      case 'step/end':
        return {
          ...state,
          lastStepBoundary: { kind: 'end', seq: event.seq },
        }
      default:
        return state
    }
  },
} satisfies ProjectionDefinition<'turnBoundary', TurnBoundaryProjection>

const cliTerminalProjectionSchema: zod.ZodType<CliTerminalProjection> = zod.object({
  profile: zod.enum(CLI_TERMINAL_PROFILE_IDS).nullable(),
})

/** Host projection of the CLI terminal profile a Session hosts; such a Session starts no turns. */
export const cliTerminalProjectionDefinition = {
  key: 'cliTerminal',
  stateVersion: 1,
  stateSchema: cliTerminalProjectionSchema,
  init: () => ({ profile: null }),
  apply: (state, event) => event.type === 'session/cli-terminal' ? { profile: event.data.profile } : state,
} satisfies ProjectionDefinition<'cliTerminal', CliTerminalProjection>
