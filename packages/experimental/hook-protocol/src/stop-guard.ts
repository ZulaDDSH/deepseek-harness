/**
 * Per-turn cap on Stop-hook forced continuations and the `stop_hook_active` flag.
 * @module @deepseek-ai/dsh-hook-protocol/stop-guard
 */

/** Default cap on Stop-hook forced continuations within one turn. */
export const DEFAULT_MAX_FORCED_STOPS = 3

/** Per-agent count of Stop-hook forced continuations; a new turn number resets it. */
export interface StopLoopGuard {
  /** Whether a Stop hook already forced `turn` to continue (the payload's `stop_hook_active`). */
  active(agent: object, turn: number): boolean
  /** Count one more forced continuation of `turn`; `false` once `maxForcedStops` is spent. */
  admit(agent: object, turn: number): boolean
}

/**
 * Create a {@link StopLoopGuard} that admits at most `maxForcedStops` forced continuations per agent turn.
 * @param maxForcedStops - the per-turn cap on forced continuations.
 * @returns a guard keyed by agent object identity and turn number.
 */
export function createStopLoopGuard(maxForcedStops: number): StopLoopGuard {
  const forced = new WeakMap<object, { turn: number; count: number }>()
  const countOf = (agent: object, turn: number): number => {
    const entry = forced.get(agent)
    return entry?.turn === turn ? entry.count : 0
  }
  return {
    active: (agent, turn) => countOf(agent, turn) > 0,
    admit(agent, turn) {
      const count = countOf(agent, turn)
      if (count >= maxForcedStops) return false
      forced.set(agent, { turn, count: count + 1 })
      return true
    },
  }
}
