import type { Context } from '@deepseek-ai/cordis'
import type { CliTerminalProfileId, Session } from '@deepseek-ai/dsh-session'

/**
 * Read the CLI terminal profile a Session hosts.
 * @param ctx - Context whose Session projections hold the agent loop's `cliTerminal` unit.
 * @param session - Session to inspect.
 * @returns the profile identity, or undefined for an ordinary Session or when no agent loop is installed.
 */
export function cliTerminalProfileOf(ctx: Context, session: Session): CliTerminalProfileId | undefined {
  return ctx.get('sessionProjections')?.snapshot(session, ['cliTerminal']).values.cliTerminal?.profile ?? undefined
}
