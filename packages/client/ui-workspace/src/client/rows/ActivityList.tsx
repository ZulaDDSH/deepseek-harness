/** Activity-oriented Session projection for the workspace browser. */
import { useMemo } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import { deriveFlat, type SessionNode } from '../tree.ts'
import { SessionNodeItem } from './Rows.tsx'
import css from './WorkspaceBrowser.module.css'

export interface ActivityListProps extends Pick<
  WorkspaceBrowserProps,
  'useSessionStatus' | 'open' | 'forkSession' | 'usePanelInfo' | 't'
> {
  list: SessionListState
  sessionIds: readonly SessionId[]
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  onSessionArchive: (sessionId: SessionNode['id']) => void
}

/** Render Sessions grouped by user attention, live work, and recent completion. */
export function ActivityList({
  list, sessionIds, useSessionStatus, open, forkSession, onSessionRename, onSessionArchive,
  usePanelInfo, t,
}: ActivityListProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const statuses = useSessionStatus(s => s)
  const rows = useMemo(() => deriveFlat(list, sessionIds, statuses), [list, sessionIds, statuses])
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
