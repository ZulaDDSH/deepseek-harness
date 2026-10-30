/** The single resolver of the Subagent Setup that governs a Session. */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SubagentSetup } from './subagent-setup.ts'
import type { ModelSelection } from './types.ts'

const MAX_SETUP_HOPS = 8

/**
 * The single resolver of the subagent setup governing a Session: its own override, else the nearest ancestor's, else the global default.
 * @param ctx - the Host context that holds the run-options projections, sessions and the session controller.
 * @param session - the Session to resolve from.
 * @returns the governing setup, or undefined when no override in the chain and no global default is set.
 */
export function effectiveSubagentSetupOf(ctx: Context, session: Session): SubagentSetup | undefined {
  let at: Session | undefined = session
  for (let hop = 0; at !== undefined && hop <= MAX_SETUP_HOPS; hop += 1) {
    const setup = ctx.get('sessionProjections')?.snapshot(at, ['runOptions']).values.runOptions?.current?.subagentSetup
    if (setup !== undefined) return setup
    at = at.header.parentSession === undefined ? undefined : ctx.get('sessions')?.get(at.header.parentSession)
  }
  return ctx.get('sessionController')?.defaultSubagentSetup()
}

/**
 * The model a Session runs on while its own setup, else the global default, is on and fixes the orchestrator to an LLM route.
 * @param ctx - the Host context that holds the run-options projections and the session controller.
 * @param session - the Session to resolve from.
 * @returns the orchestrator route, or undefined for a subagent child or when the setup does not fix an LLM orchestrator.
 */
export function orchestratorSelectionOf(ctx: Context, session: Session): ModelSelection | undefined {
  if (session.header.origin === 'subagent') return undefined
  const setup = ctx.get('sessionProjections')?.snapshot(session, ['runOptions']).values.runOptions?.current?.subagentSetup
    ?? ctx.get('sessionController')?.defaultSubagentSetup()
  if (setup?.enabled !== true) return undefined
  const orchestrator = setup.roles.orchestrator
  if (orchestrator?.mode !== 'fixed' || orchestrator.route.backend !== 'llm') return undefined
  const { provider, model, reasoningEffort } = orchestrator.route
  return { provider, model, ...reasoningEffort === undefined ? {} : { reasoningEffort } }
}
