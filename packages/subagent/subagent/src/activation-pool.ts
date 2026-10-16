/**
 * Process-local capacity pool shared by a continuable parent and its resident
 * continuable descendants, and by one-shot runs the parent delegates.
 *
 * @module @deepseek-ai/dsh-subagent/activation-pool
 */

import { SubagentError } from './error.ts'

/** Process-local slots shared through uninterrupted continuable parent links. */
export class ActivationPool {
  private readonly slots = new Set<symbol>()

  /**
   * Reserve before reconstruction; the returned release also tolerates unpublished rollback.
   * @param capacity - the most live slots the pool admits.
   * @returns the slot's release; calling it again is a no-op.
   * @throws {SubagentError} `ACTIVATION_LIMIT_REACHED` at capacity.
   */
  reserve(capacity: number): () => void {
    if (this.slots.size >= capacity) {
      throw new SubagentError(
        `subagent limit reached (active child limit: ${capacity}); wait for an existing child to finish `
        + 'or complete this work with the current agents',
        'ACTIVATION_LIMIT_REACHED',
      )
    }
    const slot = Symbol()
    this.slots.add(slot)
    return () => { this.slots.delete(slot) }
  }
}
