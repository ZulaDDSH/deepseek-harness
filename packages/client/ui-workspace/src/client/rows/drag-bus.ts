/**
 * Cross-pane drag sharing for the sidebar.
 *
 * The Workspace pane and the Chat Sections pane are independent components
 * with their own drag state, but filing a Chat is a drag that STARTS on a
 * workspace row and ENDS on a section header. A pane cannot see the other's
 * React state, so the drag source publishes here and the pane that owns the
 * current drop target reads it.
 *
 * This carries only the in-flight gesture: which Session is moving and which
 * pane started. Committing the move stays with the pane that receives the
 * drop, so the section pane remains the sole owner of section assignment and
 * the workspace tree remains the sole owner of its own reordering.
 */

/** The one in-flight workspace-originated Chat drag, or null when none is active. */
let draggedSessionId: string | null = null
const listeners = new Set<() => void>()

/**
 * Begin a Chat drag that other panes should accept.
 * @param sessionId - the Session being dragged.
 */
export function beginChatDrag(sessionId: string): void {
  draggedSessionId = sessionId
  for (const listener of listeners) listener()
}

/** End the in-flight Chat drag, whoever started it. */
export function endChatDrag(): void {
  if (draggedSessionId === null) return
  draggedSessionId = null
  for (const listener of listeners) listener()
}

/**
 * The Session id currently being dragged across panes.
 * @returns the Session id, or null when no cross-pane drag is active.
 */
export function chatDragSessionId(): string | null {
  return draggedSessionId
}

/**
 * Subscribe to cross-pane drag start and end.
 * @param listener - called whenever the in-flight drag changes.
 * @returns unsubscribe.
 */
export function subscribeChatDrag(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
