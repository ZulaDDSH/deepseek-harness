/** @module @deepseek-ai/dsh-knowledge-router/command */

import type { Context } from '@deepseek-ai/cordis'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-commands'
import type { KnowledgeMode, ProviderStatus } from './types.ts'

/** What the command reads from the router. */
export interface KnowledgeStatusTarget {
  /** Automatic-retrieval mode this deployment selected. */
  readonly mode: KnowledgeMode
  /**
   * Report every supported provider's configuration and connection state.
   * @param agent - caller whose scope the registry is read in; omitted reads the global view.
   * @returns one status per supported provider.
   */
  status(agent?: ScopeKey): ProviderStatus[]
}

/**
 * Render the status report the command returns.
 * @param target - the router to read.
 * @param agent - the agent whose scope the registry is read in.
 * @returns One line for the mode and one per provider.
 */
export function describeKnowledge(target: KnowledgeStatusTarget, agent?: ScopeKey): string {
  const lines = [`knowledge mode: ${target.mode}`]
  for (const status of target.status(agent)) {
    const state = !status.enabled ? 'disabled' : status.connected ? 'connected' : 'disconnected'
    const server = status.serverName === '' ? 'unset' : status.serverName
    const tools = status.tools.length === 0 ? '' : ` tools: ${status.tools.join(', ')}`
    lines.push(`${status.provider}: ${state} (server ${server})${tools}`)
  }
  return lines.join('\n')
}

/**
 * Register the `/knowledge` command on the calling context.
 * @param ctx - context carrying the human-command registry.
 * @param target - the router whose status the command reports.
 */
export function registerKnowledgeCommand(ctx: Context, target: KnowledgeStatusTarget): void {
  ctx.effect(() => ctx.commands.register({
    name: 'knowledge',
    description: 'Report the knowledge mode and each provider\'s connection state',
    handler: invocation => ({ kind: 'success', text: describeKnowledge(target, invocation.agent) }),
  }), 'knowledge: command')
}
