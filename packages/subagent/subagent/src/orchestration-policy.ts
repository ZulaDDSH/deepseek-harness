/**
 * Root-agent orchestration policy: one prompt section stating how the root
 * agent decides between direct work, a delegated subtask, and a workflow
 * script, and how it decomposes, steers, stops, and synthesizes delegated work.
 *
 * The section renders only for a root agent, so a delegated child — which
 * already carries its own delegation-scope statement — is never told how to
 * delegate onward. It is a separately loadable plugin rather than part of the
 * service row because it changes the model-visible prompt: a deployment opts
 * in, and a composition that omits it keeps its prompt unchanged.
 *
 * When the deployment composes a router that owns route selection, the policy
 * also states that the root must not name a child's route, because that router
 * decides each agent's route and an explicit child route bypasses it.
 *
 * @module @deepseek-ai/dsh-subagent/orchestration-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import { delegationDepthOf } from './depth.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'subagent-orchestration-policy'

/** Services required by this plugin. */
export const inject = ['systemPrompt']

/** How a root agent decides what to do itself and what to delegate. */
const ORCHESTRATION_POLICY = `You are the root agent for this session: decide what to do directly and what to delegate, and own the final answer.

Work directly when the task is small, sequential, or depends on the conversation you already hold. Delegate one bounded subtask when its work is independent and its intermediate detail would only dilute this conversation. Write a workflow script when the same kind of work fans out across many independent items and the loop, branching, and intermediate results belong in the script rather than in this conversation.

Decide the decomposition before delegating. Give each delegate one objective, the files or symbols it owns, and a stop condition. Start independent delegations together and keep working on the rest while they run; never give two delegates overlapping write ownership.

Steer a running delegate with a message when its direction is wrong, and stop its current turn when the work is no longer needed; both leave it available for a follow-up. Collect the results you depend on, check them against the original evidence, and answer only after the delegates you depend on have settled. Treat a delegate's result as evidence to review, not as the answer.`

/** Route clause for a deployment whose router selects every agent's route. */
const ROUTER_OWNED_ROUTE_POLICY = "Do not name a delegate's provider, model, or reasoning effort: this deployment's router decides each agent's route, and an explicit child route bypasses it."

/** Route clause for a deployment that routes model selection explicitly. */
const INHERITED_ROUTE_POLICY = "A delegate inherits this agent's provider, model, and reasoning effort; name a different route for it only when the task needs a different model."

/**
 * Render the policy for one assembly, or nothing when the subject is not the root agent.
 * @param ctx - plugin context carrying the optional router service.
 * @param context - the assembly's subject agent, absent on diagnostics.
 * @returns the policy text, or `''` for a delegated child or a subject-less assembly.
 */
function policyFor(ctx: Context, context: AssembleContext): string {
  const agent = context.agent
  if (agent === undefined || delegationDepthOf(agent) !== 0) return ''
  // An undeclared `ctx.get` name: the router package owns this service and a
  // composition without it leaves the read undefined.
  const router = ctx.get('jevRouter') as { readonly enabled: boolean } | undefined
  return [
    ORCHESTRATION_POLICY,
    router?.enabled === true ? ROUTER_OWNED_ROUTE_POLICY : INHERITED_ROUTE_POLICY,
  ].join('\n\n')
}

/**
 * Register the root-only orchestration policy section.
 * @param ctx - plugin context carrying the system-prompt registry.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'orchestration:policy',
    order: ctx.systemPrompt.getSectionOrder('ORCHESTRATION_POLICY'),
    text: context => policyFor(ctx, context),
  })
}
