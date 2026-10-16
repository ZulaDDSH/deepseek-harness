/**
 * Failure text a child's own log records when its last turn ended in error, so
 * a parent reads the cause instead of an empty result.
 *
 * @module @deepseek-ai/dsh-subagent/failure-diagnostic
 */

import { foldConsumedWork } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const FAILURE_DIAGNOSTIC_MAX_UNITS = 1024

const SECRET_SHAPES = [
  /\bBearer\s+\S+/gi,
  /\bsk-[\w-]{8,}/g,
  /\b(authorization|api[-_ ]?key|x-api-key|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
]

/**
 * Select the failure message of a child's last turn when that turn ended in error.
 * @param events - the child-owned events (after any seed or epoch boundary).
 * @returns the message with credential-shaped text masked, bounded for a diagnostic, or `undefined` when the last turn did not fail.
 */
export function failureDiagnosticOf(events: readonly SessionEvent[]): string | undefined {
  const reason = foldConsumedWork(events).end?.data.reason
  if (reason?.kind !== 'error') return undefined
  const masked = SECRET_SHAPES.reduce(
    (text, shape) => text.replace(shape, (_match, name: unknown, separator: unknown) =>
      typeof name === 'string' ? `${name}${String(separator)}[redacted]` : '[redacted]'),
    reason.error.message,
  )
  const cut = masked.slice(0, FAILURE_DIAGNOSTIC_MAX_UNITS)
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}
