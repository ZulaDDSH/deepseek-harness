/** The browsing rows' right-click menu: one portaled list anchored at the pointer. */
import { useState } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Rows.module.css'

/** The event fields a row needs to anchor its own menu; a React mouse event satisfies it. */
interface ContextMenuEvent {
  clientX: number
  clientY: number
  preventDefault: () => void
  stopPropagation: () => void
}

/** One row's right-click menu position plus its opener and closer. */
export interface ContextMenuState {
  /** Anchor position in viewport coordinates, or null while the menu is closed. */
  at: { x: number; y: number } | null
  /** Cancel the browser menu and anchor this row's list at the pointer. */
  open: (event: ContextMenuEvent) => void
  /** Close without selecting. */
  close: () => void
}

/**
 * Own one row's right-click menu position.
 *
 * Rows whose verbs act on real content cancel the browser context menu and open
 * their own list at the pointer, so the choices appear on the row they apply to.
 * Rows with no verbs (the ungrouped bucket, a provisional New Session) pass
 * `undefined` to the row's handler instead, leaving the browser menu alone.
 * @returns the anchor position, its opener, and its closer.
 */
export function useContextMenu(): ContextMenuState {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  return {
    at,
    open: (event) => {
      event.preventDefault()
      event.stopPropagation()
      setAt({ x: event.clientX, y: event.clientY })
    },
    close: () => { setAt(null) },
  }
}

/**
 * Render a row's right-click menu at the pointer that opened it.
 * @param props.state - the row's menu state.
 * @param props.items - the row's choice list.
 * @param props.onSelect - apply one selection; the menu closes first.
 * @returns the portaled menu, or null while the menu is closed.
 */
export function RowContextMenu({ state, items, onSelect }: {
  state: ContextMenuState
  items: readonly MenuItem[]
  onSelect: (id: string) => void
}) {
  const { at } = state
  if (at === null) return null
  return (
    <Menu
      open
      onClose={state.close}
      items={items}
      onSelect={(id) => { state.close(); onSelect(id) }}
      portal
      getAnchorRect={() => DOMRect.fromRect({ x: at.x, y: at.y })}
      anchor={<span className={css.contextAnchor} />}
    />
  )
}
