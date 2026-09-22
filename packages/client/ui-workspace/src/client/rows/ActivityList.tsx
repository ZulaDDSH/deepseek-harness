/** Activity-oriented Session projection for the workspace browser. */
import { useMemo } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import { deriveFlat, type SessionNode } from '../tree.ts'
import { SessionNodeItem } from './Rows.tsx'
import css from './ActivityList.module.css'

/** Activity-list inputs: the visible Session projection, row actions, and standard hooks. */
export interface ActivityListProps extends Pick<
  WorkspaceBrowserProps,
  'useSessionStatus' | 'open' | 'forkSession' | 'usePanelInfo' | 't'
> {
  list: SessionListState
  sessionIds: readonly SessionId[]
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  onSessionArchive: (sessionId: SessionNode['id']) => void
}

/** One attention bucket: its identity, heading copy, and member rows. */
interface ActivityGroup {
  key: 'attention' | 'running' | 'completed'
  label: string
  rows: readonly SessionNode[]
}

/**
 * Split the visible rows into the three mutually exclusive work groups. A row
 * belongs to the first group whose predicate it satisfies, so an idle Session
 * with no unread reminder appears in none of them.
 * @param rows - the visible Session rows.
 * @param t - the browser root's locale seat.
 * @returns the non-empty groups in display order.
 */
function activityGroups(rows: readonly SessionNode[], t: WorkspaceBrowserProps['t']): ActivityGroup[] {
  const waiting = (row: SessionNode): boolean => row.pendingInteraction !== undefined
  const live = (row: SessionNode): boolean => row.running || row.runningSubagentCount > 0
  return [
    { key: 'attention' as const, label: t('activity.attention'), rows: rows.filter(waiting) },
    {
      key: 'running' as const,
      label: t('activity.running'),
      rows: rows.filter(row => !waiting(row) && live(row)),
    },
    {
      key: 'completed' as const,
      label: t('activity.completed'),
      rows: rows.filter(row => !waiting(row) && !live(row) && row.completed),
    },
  ].filter(group => group.rows.length > 0)
}

/**
 * Render Sessions grouped by what they need from the operator and what they are
 * currently doing, so the work that is not finished is visible without reading
 * a list ordered by recency.
 * @param props - visible Session projection, row actions, and standard hooks.
 * @returns the activity-grouped list body.
 */
export function ActivityList({
  list, sessionIds, useSessionStatus, open, forkSession, onSessionRename, onSessionArchive,
  usePanelInfo, t,
}: ActivityListProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const statuses = useSessionStatus(s => s)
  const rows = useMemo(() => deriveFlat(list, sessionIds, statuses), [list, sessionIds, statuses])
  const groups = useMemo(() => activityGroups(rows, t), [rows, t])
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
                  onRename={onSessionRename}
                  onFork={forkSession}
                  onArchive={onSessionArchive}
                  flat
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
