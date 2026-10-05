/**
 * Jev routing types shared with clients: the decision record and the Session
 * projection that carries the latest one.
 *
 * @module @deepseek-ai/dsh-llm-jev-router/types
 */

import type {} from '@deepseek-ai/dsh-session-projection'

/** One Jev routing outcome recorded for inspection. */
export interface JevDecisionRecord {
  readonly turn: number
  readonly step: number
  readonly choice?: string
  readonly confidence?: number
  /** Id of the route applied: Jev's choice, or the fallback when Jev was not confident enough. */
  readonly route?: string
  readonly provider?: string
  readonly model?: string
  readonly error?: string
  /** True when the router stopped the turn instead of keeping the chat model. */
  readonly rejected?: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** The latest Jev routing outcome in the Session, or null before the first one. */
    jevDecision: JevDecisionRecord | null
  }
  interface SessionProjectionStateMap {
    jevDecision: JevDecisionRecord | null
  }
}
