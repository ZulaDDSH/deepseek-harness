/** @module @deepseek-ai/dsh-knowledge-router/gitnexus */

import type { Freshness } from './types.ts'

/** Separator between a GitNexus JSON payload and its appended next-step hint. */
const HINT_SEPARATOR = '\n---\n'

/** The freshness GitNexus reported for the index that answered a call. */
export interface GitnexusStaleness {
  /** Provider status word, such as `current`, `behind`, `diverged`, or `unknown`. */
  readonly status: string
  /** Commits the index is behind HEAD, when the provider reported a count. */
  readonly commitsBehind?: number
  /** The provider's own human-readable freshness hint. */
  readonly hint?: string
}

/** Read one optional string field out of an untrusted record. */
function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Read the staleness GitNexus attached to a result.
 *
 * GitNexus attaches the object only when the index is not at HEAD, so absence
 * means "the provider reported nothing" rather than "the index is current".
 *
 * @param text - the provider's text result, as returned over MCP.
 * @returns The staleness reading, or undefined when the provider reported none.
 */
export function parseStaleness(text: string): GitnexusStaleness | undefined {
  const payload = text.split(HINT_SEPARATOR)[0] as string
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch (_notJsonPayload) {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const raw = (parsed as Record<string, unknown>)['staleness']
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const status = optionalString(record, 'status')
  if (status === undefined) return undefined
  const commitsBehind = record['commitsBehind']
  const hint = optionalString(record, 'hint')
  return {
    status,
    ...typeof commitsBehind === 'number' ? { commitsBehind } : {},
    ...hint !== undefined ? { hint } : {},
  }
}

/**
 * Resolve freshness from what GitNexus reported.
 * @param staleness - the provider's staleness reading, when it attached one.
 * @returns `current` only when the provider said so, `stale` otherwise, and `unknown` when it said nothing.
 */
export function gitnexusFreshness(staleness: GitnexusStaleness | undefined): Freshness {
  if (staleness === undefined) return { kind: 'unknown' }
  if (staleness.status === 'current') return { kind: 'current' }
  return {
    kind: 'stale',
    detail: staleness.hint ?? `GitNexus reported index status ${staleness.status}`,
  }
}
