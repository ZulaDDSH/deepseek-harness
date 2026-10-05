/**
 * Route selection and per-Agent request interception for the Jev router.
 * @module @deepseek-ai/dsh-llm-jev-router/request-routing
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { Config, JevDecision, JevRoute } from './index.ts'

/** The Jev route that applies to one Agent turn, or `undefined` when Jev selected none. */
export type RouteForTurn = (agent: Agent, turn: number) => JevRoute | undefined

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

/** Apply a selected route without mutating the frozen base config.
 * @param config base DSH call configuration.
 * @param route selected destination.
 * @returns the replacement call configuration.
 */
export function applyRoute(config: LlmCallConfig, route: JevRoute): LlmCallConfig {
  const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = config
  return {
    ...withoutInheritedEffort,
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) },
  }
}

/**
 * Return a step to the model its Session or Agent selected instead of the route
 * a previous turn used, or `base` when that model is already the base route.
 */
function unrouted(ctx: Context, agent: Agent, base: LlmCallConfig): LlmCallConfig {
  const selected = ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.selected
  const fallback = selected ?? (agent.options.provider !== undefined && agent.options.model !== undefined
    ? {
      provider: agent.options.provider, model: agent.options.model,
      ...agent.options.reasoningEffort === undefined ? {} : { reasoningEffort: agent.options.reasoningEffort },
    }
    : undefined)
  if (fallback === undefined || (fallback.provider === base.provider && fallback.model === base.model)) return base
  return applyRoute(base, { id: '', description: '', ...fallback })
}

/**
 * Install one `agent/request` listener per Agent the first time it is routed.
 * The listener consults {@link enabled} on every request, so a hook installed
 * while routing was on delegates the request unchanged once the live config
 * turns routing off. It is released when its Agent is disposed and when the
 * owning fiber unloads, so a disposed Agent is not retained by its hook.
 * @param ctx - owning plugin context.
 * @param enabled - reads whether routing is currently enabled.
 * @param routeForTurn - the route Jev recorded for one Agent turn.
 * @returns an installer that hooks an Agent at most once.
 */
export function installAgentRequestRouting(
  ctx: Context,
  enabled: () => boolean,
  routeForTurn: RouteForTurn,
): (agent: Agent) => void {
  const hooked = new Map<Agent, () => void>()
  const release = (agent: Agent): void => {
    const dispose = hooked.get(agent)
    if (dispose === undefined) return
    hooked.delete(agent)
    dispose()
  }
  ctx.on('agent/disposed', ({ agent }) => { release(agent) })
  ctx.effect(() => () => {
    for (const agent of [...hooked.keys()]) release(agent)
  }, 'jev-router: per-Agent request routing')
  return (agent: Agent): void => {
    if (hooked.has(agent)) return
    hooked.set(agent, agent.ctx.on('agent/request', async (payload, next): Promise<LlmCallConfig> => {
      const base = await next()
      if (!enabled() || payload.signal.aborted) return base
      const route = routeForTurn(payload.agent, payload.turn)
      return route === undefined ? unrouted(ctx, payload.agent, base) : applyRoute(base, route)
    }, { prepend: true }))
  }
}
