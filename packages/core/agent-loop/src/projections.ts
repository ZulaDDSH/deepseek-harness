/** Host projections the agent loop reads to decide turn eligibility. */
import { z as zod } from 'zod'
import type { CliTerminalProjection } from '@deepseek-ai/dsh-agent'
import { CLI_TERMINAL_PROFILE_IDS } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

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
  wire: { viewSchema: cliTerminalProjectionSchema, view: state => state },
} satisfies ProjectionDefinition<'cliTerminal', CliTerminalProjection>
