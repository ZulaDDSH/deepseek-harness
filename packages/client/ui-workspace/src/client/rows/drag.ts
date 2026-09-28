/** Shared Session-row drag state and native drop acceptance for the browser's row lists. */
import { useEffect } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { pinCurrentBlank, type SessionNode } from '../tree.ts'

/** In-flight Session-row drag: source identity plus the current insert marker. */
export interface SessionDragState {
  /** Order account the drag reorders: a Workspace id, the ungrouped key, or the flat-list key. */
  accountKey: string
  sessionId: SessionNode['id']
  /** Source row was pinned at drag start; drop targets share the pinned block. */
  pinned: boolean
  /** Row the marker sits on and which half (insert above/below it). */
  over: { id: SessionNode['id']; half: 'before' | 'after' } | null
}

/**
 * Apply a visible drop to the complete account without removing hidden members.
 * @param order - the account's complete current order.
 * @param rows - the rows rendered for the account, in display order.
 * @param drag - the in-flight drag.
 * @param over - the drop marker.
 * @returns the next account order, or undefined when the drop changes nothing or is not allowed.
 */
export function sessionDragOrder(
  order: readonly SessionId[],
  rows: readonly SessionNode[],
  drag: SessionDragState,
  over: NonNullable<SessionDragState['over']>,
): SessionId[] | undefined {
  const source = rows.find(row => row.id === drag.sessionId)
  const target = rows.find(row => row.id === over.id)
  if (source === undefined || target === undefined || source.blank
    || source.pinned !== drag.pinned || target.pinned !== drag.pinned
    || source.id === target.id || !order.includes(source.id)) return
  const section = rows.filter(row => row.pinned === drag.pinned)
  const sourceIndex = section.findIndex(row => row.id === source.id)
  const withoutSource = section.filter(row => row.id !== source.id)
  const insertAt = withoutSource.findIndex(row => row.id === target.id) + (over.half === 'after' ? 1 : 0)
  if (insertAt === sourceIndex) return
  const next = order.filter(id => id !== source.id)
  const targetIndex = next.indexOf(target.id)
  if (targetIndex === -1) return
  next.splice(targetIndex + (over.half === 'after' ? 1 : 0), 0, source.id)
  return pinCurrentBlank(next, rows.find(row => row.blank)?.id)
}

/**
 * Accept native drops while a row drag is active.
 *
 * The listeners are document-level and unconditional in what they accept: a
 * dragover that is not default-prevented makes the browser refuse the drop
 * outright, so anything that decides acceptance from React state during the
 * gesture is racing the browser's own event sequence. A drag that starts in
 * one pane and ends in another has no single component whose state covers both
 * ends, so the guard here is only "a drag is in flight"; the panes decide what
 * a given drop means.
 *
 * @param active - whether any row drag is in flight.
 */
export function useNativeDragAcceptance(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const acceptDrag = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    const acceptDrop = (event: DragEvent): void => { event.preventDefault() }
    document.addEventListener('dragover', acceptDrag)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', acceptDrag)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [active])
}
