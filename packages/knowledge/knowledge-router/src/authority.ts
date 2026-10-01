/** @module @deepseek-ai/dsh-knowledge-router/authority */

import type { Agent } from '@deepseek-ai/dsh-agent'

/**
 * Whether an agent runs as a delegated worker.
 * @param agent - the agent to classify; an absent caller is not a worker.
 * @returns true when the agent's session records the session that started it.
 */
export function isWorker(agent: Agent | undefined): boolean {
  return agent?.session.header.parentSession !== undefined
}

/**
 * Reject a knowledge operation that only a supervising agent may perform.
 *
 * The check belongs to the operation that persists the knowledge rather than to
 * its tool, so a direct service caller cannot bypass it.
 *
 * @param agent - the agent attempting the operation.
 * @param operation - the model-facing operation used in the rejection reason.
 * @throws when the agent is a delegated worker.
 */
export function assertSupervisor(agent: Agent | undefined, operation: string): void {
  if (!isWorker(agent)) return
  throw new Error(
    `a delegated worker may not ${operation}; report the finding to the session that started this one, which records it after validating it`,
  )
}
