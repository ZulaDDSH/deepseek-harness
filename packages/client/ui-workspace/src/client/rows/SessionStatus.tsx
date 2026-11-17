/** Session status derivation and the compact status dot shared by session and search rows. */
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { SessionNode } from '../tree.ts'
import css from './Rows.module.css'

type RowTranslate = WorkspaceBrowserProps['t']

/** One status line: dot state, full label, and the optional compact trailing text. */
export interface SessionStatus {
  state: StateDotState
  label: string
  /** Compact text that replaces the Session row's update time. */
  trailingLabel?: string
}

/* v8 ignore next 3 -- closed-union backstop; only reached if the status is forged */
function assertNever(value: never): never {
  throw new Error(`unknown pending interaction: ${String(value)}`)
}

/**
 * Resolve status priority for a session row: an unacknowledged failure is
 * primary, then pending interaction, then live activity, then the completion
 * reminder.
 * @param node - the row's status facts.
 * @param t - the browser root's locale seat.
 * @returns the primary status followed by every other relevant status.
 */
export function sessionStatuses(
  node: Pick<SessionNode, 'pendingInteraction' | 'running' | 'runningSubagentCount' | 'completed' | 'failed'>,
  t: RowTranslate,
): readonly [SessionStatus, ...SessionStatus[]] {
  if (node.failed === true) {
    return [{ state: 'error', label: t('status.failed'), trailingLabel: t('status.failed') }]
  }
  const subagents: SessionStatus | undefined = node.runningSubagentCount === 0
    ? undefined
    : {
      state: 'ongoing',
      label: t(
        node.runningSubagentCount === 1
          ? 'status.subagentsRunning.one'
          : 'status.subagentsRunning.other',
        { n: node.runningSubagentCount },
      ),
    }
  let pending: SessionStatus | undefined
  switch (node.pendingInteraction) {
    case 'approval':
      pending = {
        state: 'warning',
        label: t('status.waitingApproval'),
        trailingLabel: t('status.compact.approval'),
      }
      break
    case 'plan-review':
      pending = {
        state: 'warning',
        label: t('status.planReview'),
        trailingLabel: t('status.compact.planReview'),
      }
      break
    case 'question':
      pending = {
        state: 'warning',
        label: t('status.waitingAnswer'),
        trailingLabel: t('status.compact.answer'),
      }
      break
    case undefined: break
    /* v8 ignore next -- closed PendingInteractionStatus union */
    default: return assertNever(node.pendingInteraction)
  }
  if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents]
  if (node.running) {
    const primary: SessionStatus = { state: 'ongoing', label: t('status.running') }
    return subagents === undefined ? [primary] : [primary, subagents]
  }
  if (subagents !== undefined) return [subagents]
  if (node.completed) return [{ state: 'done', label: t('status.completed') }]
  return [{ state: 'idle', label: t('status.idle') }]
}

/**
 * Render the primary status dot and accessible status labels.
 * @param props.statuses - the row's statuses, primary first.
 * @param props.visiblePrimary - the row already shows the primary label as text, so only the rest stay screen-reader-only.
 * @returns the dot plus visually hidden labels.
 */
export function SessionStatusDots({ statuses, visiblePrimary = false }: {
  statuses: readonly [SessionStatus, ...SessionStatus[]]
  visiblePrimary?: boolean
}) {
  return (
    <>
      <StateDot state={statuses[0].state} />
      {statuses.map((status, index) => (
        visiblePrimary && index === 0
          ? null
          : <span className={css.visuallyHidden} key={status.label}>{status.label}</span>
      ))}
    </>
  )
}
