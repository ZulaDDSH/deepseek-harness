/**
 * Delegation-tool visibility at the depth cap.
 * @module @deepseek-ai/dsh-tool-subagent/depth-limit
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { delegationDepthOf } from '@deepseek-ai/dsh-subagent'

/**
 * Whether an agent cannot start a child under the effective delegation cap.
 * @param ctx - context whose subagent service resolves the cap.
 * @param configured - the delegation tool's configured `maxDepth`.
 * @param agent - the agent that would start the child.
 * @returns true when the agent's child would exceed the cap.
 */
export function cannotDelegate(
  ctx: Context,
  configured: number | 'provider-managed' | undefined,
  agent: Agent,
): boolean {
  const maxDepth = ctx.subagents.resolveMaxDepth(configured)
  return maxDepth !== undefined && delegationDepthOf(agent) + 1 > maxDepth
}

/**
 * Restrict an inherited delegation tool on each child created below `ctx` that cannot delegate.
 * @param ctx - the composition context that registers the tool.
 * @param toolName - the tool's model-facing name.
 * @param configured - the delegation tool's configured `maxDepth`.
 */
export function restrictAtDepthLimit(
  ctx: Context,
  toolName: string,
  configured: number | 'provider-managed' | undefined,
): void {
  const composed = scopeOf(ctx)
  ctx.on('agent/created', ({ agent }) => {
    const scope = scopeOf(agent.ctx)
    const tools = agent.ctx.get('tools')
    if (scope === undefined || scope === composed || tools === undefined) return
    if (tools.get(toolName, scope) === undefined || !cannotDelegate(ctx, configured, agent)) return
    tools.restrict({ deny: [toolName] })
  })
}
