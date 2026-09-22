/** Session status derivation and compact row indicators. */
import clsx from 'clsx'
import { IconAlarmClockOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { SessionNode } from '../tree.ts'
import css from './Rows.module.css'

type RowTranslate = WorkspaceBrowserProps['t']

/** One Session status indicator: the dot state plus its screen-reader label. */
export interface SessionStatus {
  state: StateDotState
  label: string
}

/* v8 ignore next 3 -- closed-union backstop; only reached if the status is forged */
function assertNever(value: never): never {
  throw new Error(`unknown pending interaction: ${String(value)}`)
}

/**
 * Resolve status priority for a session row: an unacknowledged background
 * failure leads, then pending interaction, then live activity, then the
 * finished-but-unviewed reminder.
 * @param node - the session facts the priority reads.
 * @param t - the row's locale seat.
 * @returns the primary status followed by every secondary status.
 */
export function sessionStatuses(
  node: Pick<SessionNode, 'pendingInteraction' | 'running' | 'runningSubagentCount' | 'completed' | 'failed'>,
  t: RowTranslate,
): readonly [SessionStatus, ...SessionStatus[]] {
  if (node.failed === true) return [{ state: 'error', label: t('status.failed') }]
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
      pending = { state: 'warning', label: t('status.waitingApproval') }
      break
    case 'plan-review':
      pending = { state: 'warning', label: t('status.planReview') }
      break
    case 'question':
      pending = { state: 'warning', label: t('status.waitingAnswer') }
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
  return [{ state: 'done', label: t('status.idle') }]
}

/**
 * Whether the row prints its primary status as visible text: a failure or an
 * actionable or live state is worth spelling out, while an idle or completed
 * row keeps the dot alone so the list stays quiet.
 * @param node - the derived session node.
 * @returns true when the primary status label is rendered beside the dot.
 */
export function showsStatusLabel(node: SessionNode): boolean {
  if (node.blank) return false
  if (node.failed === true || node.pendingInteraction !== undefined) return true
  return node.running || node.runningSubagentCount > 0
}

/**
 * Render the primary status dot and the screen-reader labels for the statuses
 * the row does not already print as text.
 * @param props.statuses - the row's primary status plus every secondary status.
 * @param props.visiblePrimary - the row prints the primary label as visible text.
 * @returns the dot followed by the hidden labels.
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

/**
 * Render one status line for a hover card: the dot plus its visible label.
 * @param props.status - the single status to describe.
 * @returns the hover-card status row.
 */
export function SessionStatusLine({ status }: { status: SessionStatus }) {
  return (
    <div className={css.hoverStatus}>
      <StateDot state={status.state} />
      <span>{status.label}</span>
    </div>
  )
}

/**
 * Render the non-interactive active-Schedule marker.
 * @param props.t - the row's locale seat.
 * @param props.search - the marker sits inside a search-result heading.
 * @returns the alarm marker.
 */
export function ActiveScheduleIndicator({ t, search = false }: { t: RowTranslate; search?: boolean }) {
  const label = t('schedule.active')
  return (
    <span
      className={clsx(css.scheduleIndicator, search && css.searchScheduleIndicator)}
      role="img"
      aria-label={label}
      title={label}
    >
      <IconAlarmClockOutline16 />
    </span>
  )
}
