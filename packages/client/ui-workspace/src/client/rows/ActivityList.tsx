/** Activity-oriented Session projection for the workspace browser. */
import { useMemo } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { WorkspaceAppearance } from '../appearance.ts'
import { deriveFlat, type SessionNode, type SessionRowState } from '../tree.ts'
import { SessionNodeItem, type RowRenderSlots } from './Rows.tsx'
import css from './WorkspaceBrowser.module.css'

/** Props of the activity-centered body. */
export interface ActivityListProps extends Pick<
  WorkspaceBrowserProps,
  'useSessionStatus' | 'open' | 'usePanelInfo' | 't'
> {
  list: SessionListState
  appearanceBySession: Readonly<Record<string, WorkspaceAppearance>>
  onSessionAppearanceChange: (sessionId: SessionId, change: WorkspaceAppearance) => void
  sessionIds: readonly SessionId[]
  /** Registry-global pin and archive sets plus the archived-visibility choice. */
  rowState: SessionRowState
  /** Open the rename dialog from a row title double-click. */
  onSessionRenameRequest: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** Child-seat renderer for the rows' action lists, leading decoration, and hover section. */
  renderSlot: RowRenderSlots
}

/**
 * Render Sessions grouped by user attention, live work, and recent completion.
 * @param props - flat membership, row seats, and standard hooks.
 * @returns the activity-centered body.
 */
export function ActivityList({
  list, sessionIds, rowState, appearanceBySession, onSessionAppearanceChange, useSessionStatus, open,
  onSessionRenameRequest, renderSlot, usePanelInfo, t,
}: ActivityListProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const statuses = useSessionStatus(s => s)
  const rows = useMemo(() => deriveFlat(list, sessionIds, rowState, statuses), [list, sessionIds, rowState, statuses])
  const groups = useMemo(() => [
    { key: 'attention', label: t('activity.attention'), rows: rows.filter(row => row.failed === true || row.pendingInteraction !== undefined) },
    {
      key: 'running', label: t('activity.running'),
      rows: rows.filter(row => row.failed !== true
        && row.pendingInteraction === undefined && (row.running || row.runningSubagentCount > 0)),
    },
    {
      key: 'completed', label: t('activity.completed'),
      rows: rows.filter(row => row.failed !== true && row.pendingInteraction === undefined
        && !row.running && row.runningSubagentCount === 0 && row.completed),
    },
  ].filter(group => group.rows.length > 0), [rows, t])
  const currentId = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const now = Date.now()

  return (
    <div className={css.treeBody}>
      <div className={css.list} role="tree" aria-label={t('groupBy.activity')}>
        {groups.length === 0 && <div className={css.empty}>{t('activity.empty')}</div>}
        {groups.map(group => (
          <div className={css.activitySection} role="group" aria-label={group.label} key={group.key}>
            <div className={css.activityHeading}>{group.label}</div>
            <div className={css.activityRows}>
              {group.rows.map(node => (
                <SessionNodeItem
                  key={node.id}
                  node={node}
                  currentId={currentId}
                  now={now}
                  onOpen={open}
                  onRenameRequest={onSessionRenameRequest}
                  renderSlot={renderSlot}
                  appearance={appearanceBySession[node.id]}
                  appearanceActions={{
                    color: (color) => { onSessionAppearanceChange(node.id, { color }) },
                    icon: (icon) => { onSessionAppearanceChange(node.id, { icon }) },
                  }}
                  t={t}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <span className={css.fade} />
    </div>
  )
}
