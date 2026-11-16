/**
 * Route selection and unrouted fallback for the Jev router.
 * @module @deepseek-ai/dsh-llm-jev-router/request-routing
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import { orchestratorSelectionOf } from '@deepseek-ai/dsh-api-session-controller/setup-resolver'
import type { Config, JevDecision, JevRoute } from './index.ts'

/** Resolve a decision through confidence and fallback policy.
 * @param decision parsed Jev decision.
 * @param config active router settings.
 * @returns an allow-listed route or undefined to preserve the base route.
 */
export function selectedRoute(decision: JevDecision, config: Config): JevRoute | undefined {
  const route = config.routes.find(candidate => candidate.id === decision.route)
  if (route !== undefined && decision.confidence >= config.minConfidence) return route
  if (config.fallback === 'keep') return undefined
  return config.routes.find(candidate => candidate.id === config.fallback)
}

/** The model selection a Jev route names; an absent effort follows adapter defaults.
 * @param route selected destination.
 * @returns a detached selection for one step.
 */
export function routeSelection(route: JevRoute): ModelSelection {
  return {
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) },
  }
}

/**
 * The selection a step runs on when Jev selected no route: the orchestrator's
 * fixed route, else the Session's pick, else the Agent's configured route.
 * @param ctx - owning plugin context.
 * @param agent - the Agent proposing the step.
 * @returns a detached selection, or undefined when none of those names both provider and model.
 */
export function unroutedSelection(ctx: Context, agent: Agent): ModelSelection | undefined {
  const selected = orchestratorSelectionOf(ctx, agent.session)
    ?? ctx.get('agents')?.modelSelectionOf(agent.session).pending
  if (selected) {
    return {
      provider: selected.provider,
      model: selected.model,
      ...selected.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(selected.reasoningEffort) },
    }
  }
  const { provider, model, reasoningEffort } = agent.options
  return provider !== undefined && model !== undefined
    ? { provider, model, ...reasoningEffort === undefined ? {} : { reasoningEffort } }
    : undefined
}
