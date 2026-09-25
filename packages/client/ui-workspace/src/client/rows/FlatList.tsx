/** Flat Session list projection with browser-local drag ordering. */
import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { WorkspaceAppearance } from '../appearance.ts'
import { deriveFlat, type SessionNode, type SessionRowState } from '../tree.ts'
import { FLAT_SESSION_ORDER_KEY } from '../stores.ts'
import { AnimatedRows } from './AnimatedRows.tsx'
import { EmptySessions } from './EmptySessions.tsx'
import { SessionNodeItem, type RowRenderSlots } from './Rows.tsx'
import css from './WorkspaceBrowser.module.css'
import { sessionDragOrder, type SessionDragState, useNativeDragAcceptance } from './drag.ts'

/** Props of the flat "In one list" body. */
export interface FlatListProps extends Pick<
  WorkspaceBrowserProps,
  'useSessionStatus' | 'open' | 'usePanelInfo' | 't'
> {
  list: SessionListState
  appearanceBySession: Readonly<Record<string, WorkspaceAppearance>>
  onSessionAppearanceChange: (sessionId: SessionId, change: WorkspaceAppearance) => void
  sessionIds: readonly SessionId[]
  /** Registry-global pin and archive sets plus the archived-visibility choice. */
  rowState: SessionRowState
  /** Switch the archived filter back to the default hide-archived view. */
  onLeaveArchivedOnly: () => void
  /** Whether the current Workspace stream has a complete Host baseline. */
  workspaceReady: boolean
  /** Grouping, ordering, and filter changes replace the view without row motion. */
  animationResetKey: string
  setSessionOrder: (accountKey: string, order: readonly string[]) => void
  /** Open the rename dialog from a row title double-click. */
  onSessionRenameRequest: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** Child-seat renderer for the rows' action lists, leading decoration, and hover section. */
  renderSlot: RowRenderSlots
  revealSessionId?: SessionId | undefined
  onSessionRevealed: (sessionId: SessionId) => void
}

/**
 * Render every visible Session as one draggable top-level row.
 * @param props - flat membership, ordering callback, row seats, and standard hooks.
 * @returns the flat Session list.
 */
export function FlatList({
  list, sessionIds, rowState, onLeaveArchivedOnly, appearanceBySession, onSessionAppearanceChange,
  useSessionStatus, open, onSessionRenameRequest, renderSlot,
  usePanelInfo, setSessionOrder, workspaceReady, animationResetKey, revealSessionId, onSessionRevealed, t,
}: FlatListProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const statuses = useSessionStatus(s => s)
  const rows = useMemo(
    () => deriveFlat(list, sessionIds, rowState, statuses),
    [list, sessionIds, rowState, statuses],
  )
  const [drag, setDrag] = useState<SessionDragState | null>(null)
  const dropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)
  const currentId = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const commitDrag = (activeDrag: SessionDragState, over: NonNullable<SessionDragState['over']>): void => {
    if (dropCommitted.current) return
    dropCommitted.current = true
    setDrag(null)
    const nextOrder = sessionDragOrder(sessionIds, rows, activeDrag, over)
    if (nextOrder !== undefined) setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder)
  }
  const now = Date.now()
  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <AnimatedRows
        className={clsx(css.list, css.flatList)}
        label={t('section.sessions')}
        rowKeys={rows.length === 0 ? ['empty'] : rows.map(row => `session:${row.id}`)}
        ready={list.phase === 'ready' && workspaceReady && drag === null}
        resetKey={animationResetKey}
      >
        {rows.length === 0 && (
          <EmptySessions rowState={rowState} onLeaveArchivedOnly={onLeaveArchivedOnly} t={t} />
        )}
        {rows.map((node) => {
          const active = drag !== null && drag.pinned === node.pinned
          const normalizeHalf = (half: 'before' | 'after'): 'before' | 'after' =>
            node.blank ? 'after' : half
          return (
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
              onReveal={node.id === revealSessionId
                ? () => { onSessionRevealed(node.id) }
                : undefined}
              drag={{
                start: () => {
                  dropCommitted.current = false
                  setDrag({ accountKey: FLAT_SESSION_ORDER_KEY, sessionId: node.id, pinned: node.pinned, over: null })
                },
                active,
                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                hover: (half) => {
                  setDrag(current => current === null ? current : {
                    ...current, over: { id: node.id, half: normalizeHalf(half) },
                  })
                },
                drop: (half) => {
                  if (drag !== null) commitDrag(drag, { id: node.id, half: normalizeHalf(half) })
                },
                end: () => {
                  if (drag?.over !== null && drag?.over !== undefined) commitDrag(drag, drag.over)
                  else setDrag(null)
                  dropCommitted.current = false
                },
              }}
              t={t}
            />
          )
        })}
      </AnimatedRows>
      <span className={css.fade} />
    </div>
  )
}
