/** Flat Session list projection with browser-local drag ordering. */
import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import { deriveFlat, pinCurrentBlank, type SessionNode } from '../tree.ts'
import { FLAT_SESSION_ORDER_KEY } from '../stores.ts'
import { SessionNodeItem } from './Rows.tsx'
import css from './WorkspaceBrowser.module.css'
import { useNativeDragAcceptance } from './drag.ts'

interface DragState {
  sessionId: SessionNode['id']
  over: { id: SessionNode['id']; half: 'before' | 'after' } | null
}

/** Flat-list inputs: membership, ordering callback, row actions, and standard hooks. */
export interface FlatListProps extends Pick<
  WorkspaceBrowserProps,
  'useSessionStatus' | 'open' | 'forkSession' | 'usePanelInfo' | 't'
> {
  list: SessionListState
  sessionIds: readonly SessionId[]
  setSessionOrder: (accountKey: string, order: readonly string[]) => void
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  onSessionArchive: (sessionId: SessionNode['id']) => void
  revealSessionId?: SessionId | undefined
  onSessionRevealed: (sessionId: SessionId) => void
}

/**
 * Render every visible Session as one draggable top-level row.
 * @param props - flat membership, ordering callback, row actions, and standard hooks.
 * @returns the flat Session list.
 */
export function FlatList({
  list, sessionIds, useSessionStatus, open, forkSession, onSessionRename, onSessionArchive,
  usePanelInfo, setSessionOrder, revealSessionId, onSessionRevealed, t,
}: FlatListProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const statuses = useSessionStatus(s => s)
  const rows = useMemo(
    () => deriveFlat(list, sessionIds, statuses),
    [list, sessionIds, statuses],
  )
  const [drag, setDrag] = useState<DragState | null>(null)
  const dropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)
  const currentId = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const commitDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (dropCommitted.current) return
    dropCommitted.current = true
    setDrag(null)
    const targetIndex = rows.findIndex(row => row.id === over.id)
    if (targetIndex === -1) return
    const anchor = over.half === 'before' ? over.id : rows[targetIndex + 1]?.id
    if (anchor === activeDrag.sessionId) return
    const sourceIndex = rows.findIndex(row => row.id === activeDrag.sessionId)
    const anchorIndex = anchor === undefined ? rows.length : rows.findIndex(row => row.id === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    const nextOrder = rows.map(row => row.id).filter(id => id !== activeDrag.sessionId)
    const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
    const currentBlank = rows.find(node => node.blank)?.id
    setSessionOrder(FLAT_SESSION_ORDER_KEY, pinCurrentBlank(nextOrder, currentBlank))
  }
  const now = Date.now()
  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={clsx(css.list, css.flatList)} role="tree" aria-label={t('section.sessions')}>
        {rows.length === 0 && <div className={css.empty}>{t('empty.none')}</div>}
        {rows.map((node) => {
          const active = drag !== null
          const normalizeHalf = (half: 'before' | 'after'): 'before' | 'after' =>
            node.blank ? 'after' : half
          return (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={currentId}
              now={now}
              onOpen={open}
              onRename={onSessionRename}
              onFork={forkSession}
              onArchive={onSessionArchive}
              onReveal={node.id === revealSessionId
                ? () => { onSessionRevealed(node.id) }
                : undefined}
              flat
              drag={{
                start: () => {
                  dropCommitted.current = false
                  setDrag({ sessionId: node.id, over: null })
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
      </div>
      <span className={css.fade} />
    </div>
  )
}
