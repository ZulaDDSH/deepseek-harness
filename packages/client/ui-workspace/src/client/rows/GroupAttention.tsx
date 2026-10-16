/** Collapsed Workspace attention dot: the strongest folded state plus an accessible count. */
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { GroupAttention } from '../tree.ts'
import css from './Rows.module.css'

/**
 * Render the folded attention marker of a collapsed Workspace row.
 * @param props.attention - folded counts.
 * @param props.t - the browser root's locale seat.
 * @returns the dot with its accessible label.
 */
export function GroupAttentionDot({ attention, t }: { attention: GroupAttention; t: WorkspaceBrowserProps['t'] }) {
  const waiting = attention.failed + attention.pending
  const n = waiting > 0 ? waiting : attention.running
  const label = waiting > 0
    ? t(n === 1 ? 'group.attention.one' : 'group.attention.other', { n })
    : t(n === 1 ? 'group.running.one' : 'group.running.other', { n })
  const state = attention.failed > 0 ? 'error' : attention.pending > 0 ? 'warning' : 'ongoing'
  return (
    <span className={css.groupAttention} role="img" aria-label={label} title={label}>
      <StateDot state={state} />
    </span>
  )
}
