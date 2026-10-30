/**
 * Pure client-safe subagent projection vocabulary.
 *
 * @module @deepseek-ai/dsh-subagent/projection-types
 */

import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'

/** One current direct-child discovery row materialized from parent facts. */
export type SubagentCatalogEntry =
  & {
    readonly id: SessionId
    readonly createdAt: number
  }
  & (
    | { readonly mode: 'one-shot'; readonly label?: string }
    | { readonly mode: 'external'; readonly label?: string }
    | { readonly mode: 'continuable'; readonly label: string }
    | { readonly mode: 'unknown'; readonly label?: string }
  )

/** Durable active-turn timing for one descriptor-backed child session. */
export interface SubagentTimingProjection {
  /** Milliseconds accumulated across completed turns after the child's own descriptor. */
  settledMs: number
  /** Same-cut bounds of the currently open turn, when one has not reached `turn/end`. */
  active?: {
    /** Start of the open turn. */
    since: number
    /** Latest event time folded into this projection cut. */
    through: number
  }
  /**
   * Whether the latest closed turn after the child's own descriptor completed
   * normally; absent while a turn is open or before one closes.
   */
  lastTurnCompleted?: boolean
}

/** One tool call a subagent has issued, as shown on its catalog row. */
export interface SubagentToolActivity {
  readonly callId: string
  readonly name: string
  /** Command, path, pattern, or URL the call acts on; empty when no argument says. */
  readonly detail: string
  readonly since: number
}

/** Live step count, the tool call awaiting a result, and the latest finished call of a subagent's open or last turn. */
export interface SubagentActivityProjection {
  readonly steps: number
  readonly running?: SubagentToolActivity
  readonly last?: {
    readonly name: string
    readonly detail: string
    readonly isError: boolean
    /** First line of the call's text result, bounded. */
    readonly summary: string
    readonly time: number
  }
}

/**
 * Durable identity of one descriptor-backed subagent session: lifecycle mode
 * plus creation label, folded last-wins from `subagent/descriptor` events.
 * Label strength follows the descriptor schema: a continuable child always
 * carries one, a one-shot child may omit it.
 */
export type SubagentIdentityProjection =
  | {
    /** A terminal one-shot child. */
    mode: 'one-shot'
    /** Optional durable creation label from the child's descriptor. */
    label?: string
    /**
     * Seq of the `subagent/descriptor` event this identity was folded from.
     * `session.isOwnSeq(seq)` proves the identity comes from the child's
     * OWN log suffix — where a descriptor is immutable once appended — and
     * not from a fork seed's replayed ancestor descriptor.
     */
    seq: SessionSeq
    routePinned?: true
  }
  | {
    /** A resumable conversation. */
    mode: 'continuable'
    /** Durable creation label from the child's descriptor. */
    label: string
    /** Seq of the folded descriptor event; see the one-shot arm for the own-suffix proof. */
    seq: SessionSeq
    routePinned?: true
  }

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Direct children in parent catalog event order, excluding fork-inherited facts. */
    subagentCatalog: SubagentCatalogEntry[]
    /** Active-turn duration and latest closed-turn completion for a descriptor-backed subagent session. */
    subagentTiming: SubagentTimingProjection
    /** Tool call in flight, latest finished call, and step count for a subagent session. */
    subagentActivity: SubagentActivityProjection
    /**
     * Identity of a descriptor-backed subagent session. `null` ⟺ no valid
     * descriptor (missing, malformed, or unrecognized-version — deliberately
     * undistinguished). The sentinel is deliberately serializable: a
     * value pushed over JSON transports must survive `JSON.stringify`
     * losslessly, where an `undefined` field would be dropped and a stale
     * identity would survive on the receiving side. The entry itself stays
     * non-optional.
     */
    subagent: SubagentIdentityProjection | null
  }
}
