import { useEffect } from 'react'

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
