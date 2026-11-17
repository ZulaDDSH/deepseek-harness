import type { SessionRunOptions } from '@deepseek-ai/dsh-api-session-controller'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

const MAX_RUN_OPTION_HOPS = 8

/** Presence of the Claude Code run controls; only an installed Claude Code provider registers it. */
export const claudeCodeRunOptionsProjection = {
  key: 'claudeCodeRunOptions',
  stateSchema: z.null(),
  init: () => null,
  apply: state => state,
  wire: { viewSchema: z.object({ available: z.literal(true) }), view: () => ({ available: true as const }) },
  stateVersion: 1,
} satisfies ProjectionDefinition<'claudeCodeRunOptions', null>

/**
 * Read the nearest Session run options along the delegation chain.
 * @param session - the delegating Session.
 * @param current - reads one Session's projected run options.
 * @param parentOf - resolves a live parent Session by id.
 * @returns the closest non-null run options within eight parent hops, or `undefined`.
 */
export function inheritedRunOptions(
  session: Session,
  current: (session: Session) => SessionRunOptions | null | undefined,
  parentOf: (id: SessionId) => Session | undefined,
): SessionRunOptions | undefined {
  let at: Session | undefined = session
  for (let hop = 0; at !== undefined && hop <= MAX_RUN_OPTION_HOPS; hop += 1) {
    const options = current(at)
    if (options !== null && options !== undefined) return options
    const parentId = at.header.parentSession
    if (parentId === undefined) return undefined
    at = parentOf(parentId)
  }
  return undefined
}
