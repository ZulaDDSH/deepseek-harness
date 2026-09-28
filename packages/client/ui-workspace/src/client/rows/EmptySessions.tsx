/** The Session list's empty placeholder, shared by the grouped tree and the flat list. */
import { IconArchiveOutlineRegular, IconQueueOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { SessionRowState } from '../tree.ts'
import css from './WorkspaceBrowser.module.css'

/**
 * The list-empty placeholder — a glyph over the text; the archived-only view names its filter and offers the way back.
 * @param props.rowState - pin and archive sets plus the archived-visibility choice.
 * @param props.onLeaveArchivedOnly - switch the archived filter back to the default view.
 * @param props.t - the browser root's locale seat.
 * @returns the placeholder element.
 */
export function EmptySessions({ rowState, onLeaveArchivedOnly, t }: {
  rowState: SessionRowState
  onLeaveArchivedOnly: () => void
  t: WorkspaceBrowserProps['t']
}) {
  const archivedOnly = rowState.archivedFilter === 'only'
  return (
    <div className={css.emptyState} data-row-key="empty">
      {archivedOnly ? <IconArchiveOutlineRegular size={24} /> : <IconQueueOutlineRegular size={24} />}
      <div>{archivedOnly ? t('empty.noneArchived') : t('empty.none')}</div>
      {archivedOnly && (
        <button type="button" className={css.emptyAction} onClick={onLeaveArchivedOnly}>
          {t('empty.viewOthers')}
        </button>
      )}
    </div>
  )
}
