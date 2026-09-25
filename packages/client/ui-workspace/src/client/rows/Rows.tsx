/**
 * Workspace browser tree row components (figma Cell set 14:3080): pure presentational —
 * all data and callbacks arrive via props. Hover swaps (folder->chevron,
 * time->ellipsis, action buttons) are CSS-only, and a session row's clipped
 * title marquees programmatically while the row is hovered. Workspace row
 * menus offer the appearance choices plus Rename/Delete. A Session row's "..."
 * menu and its hover buttons are the `sidebar.workspaces.session.menu.item`
 * and `sidebar.workspaces.session.row.action` lists, rendered through the
 * browser's `renderSlot` with the menu's open state as the occurrence's hook
 * context; this package's own actions are entries like any plugin's. The
 * browser-local appearance and Chat Section rows lead that menu as data rows,
 * and a right-click opens the same menu at the pointer. Chat Section headers
 * render here too. The session and workspace hover cards are suppressed while
 * a menu is open.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import clsx from 'clsx'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import {
  HoverCard, IconArchiveOutlineRegular, IconEditOutlineRegular,
  IconEllipsisOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
  IconNewChatOutlineRegular, IconPinFillRegular, IconPlusOutlineRegular, IconTrashOutlineRegular,
  IconTriangleRightFillRegular, IconUnarchiveOutlineRegular, Menu, relativeTime, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry, MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import { abbreviateHomePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { MenuOpenState, WorkspaceBrowserProps } from '../contract/slots.ts'
import { WORKSPACE_APPEARANCE_COLORS, WORKSPACE_COLORS, WORKSPACE_ICONS } from '../appearance.ts'
import type { WorkspaceAppearance, WorkspaceColor, WorkspaceIcon } from '../appearance.ts'
import type { ChatSection } from '../stores.ts'
import type { SectionNode } from '../sections.ts'
import type { GroupNode, SearchResultNode, SessionNode } from '../tree.ts'
import { WORKSPACE_ICON_GLYPHS } from './WorkspaceIcons.ts'
import { SessionStatusDots, sessionStatuses } from './SessionStatus.tsx'
import css from './Rows.module.css'

/** The standard locale seat, prop-passed from the browser root. */
type RowTranslate = WorkspaceBrowserProps['t']

/**
 * Child-seat renderer threaded from the browser root: the row's action lists,
 * its leading decoration, and its hover-card section. The leading seat is
 * rendered only while the row's primary state is idle, so a status dot and a
 * leading occupant never share the row; the hover seat only while the row's
 * card is open.
 */
export type RowRenderSlots = PropsRenderSlots<
  | 'sidebar.workspaces.session.menu.item'
  | 'sidebar.workspaces.session.row.action'
  | 'sidebar.session.row.leading'
  | 'sidebar.session.row.hover'
>['renderSlot']

/** Row display title: blank rows show the localized New Session label. */
function displayTitle(node: SessionNode, t: RowTranslate): string {
  return node.blank ? t('session.new') : node.title
}

/* Overflow this small hides no meaningful tail; scrolling for it reads as an
   accidental jitter, so the title stays put. */
const MIN_TITLE_REVEAL_PX = 8

/* Marquee travel speed: slow enough to read the text as it passes. */
const TITLE_MARQUEE_PX_PER_MS = 0.03

/**
 * Place the title's scroll position and publish the stylesheet's fade-mask
 * hooks: `data-scrolled` while the title has left its start (left fade) and
 * `data-clipped` while text remains beyond the right edge (right fade).
 * @param title - the row's clipping title element.
 * @param left - scroll offset in CSS pixels.
 * @param range - the title's maximum scroll offset in CSS pixels.
 */
function placeTitle(title: HTMLSpanElement, left: number, range: number): void {
  // jsdom implements no scrollTo; the lane's direct assignment is instant there
  // anyway, so both paths land on the same position.
  if (typeof title.scrollTo === 'function') title.scrollTo({ left, behavior: 'instant' })
  else title.scrollLeft = left
  if (left > 0) title.dataset.scrolled = ''
  else delete title.dataset.scrolled
  if (left < range) title.dataset.clipped = ''
  else delete title.dataset.clipped
}

/**
 * Return the title to its resting state: scrolled to the start with both fade
 * masks off, so the resting ellipsis renders at full strength.
 * @param title - the row's clipping title element.
 */
function restTitle(title: HTMLSpanElement): void {
  if (typeof title.scrollTo === 'function') title.scrollTo({ left: 0, behavior: 'instant' })
  else title.scrollLeft = 0
  delete title.dataset.scrolled
  delete title.dataset.clipped
}

/**
 * Marquee a title wider than its one-line cell while its row is hovered: the
 * title clips its own text, so entering crawls it at a constant speed until the
 * far edge (a fork's incremented title, for example) is in view, then rests
 * there under the pointer. Overflow of at most {@link MIN_TITLE_REVEAL_PX}
 * stays put — a barely-clipped title moving a few pixels reads as jitter, not a
 * reveal. Leaving returns the title to the start in one step, because the
 * resting ellipsis and the narrowed cell would otherwise meet the text while it
 * travelled back. Reduced motion jumps to the far edge instead of crawling.
 * @param title - ref to the row's clipping title element.
 * @returns stable pointer enter/leave handlers for the row.
 */
function useTitleMarquee(title: RefObject<HTMLSpanElement | null>): { enter: () => void; leave: () => void } {
  const frame = useRef(0)
  useEffect(() => () => { cancelAnimationFrame(frame.current) }, [])
  return useMemo(() => ({
    enter: (): void => {
      /* v8 ignore next -- defensive: the title span renders unconditionally. */
      if (title.current === null) return
      const element = title.current
      const range = element.scrollWidth - element.clientWidth
      if (range <= MIN_TITLE_REVEAL_PX) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        placeTitle(element, range, range)
        return
      }
      cancelAnimationFrame(frame.current)
      let previous: number | undefined
      let position = 0
      const step = (now: DOMHighResTimeStamp): void => {
        position += previous === undefined ? 0 : (now - previous) * TITLE_MARQUEE_PX_PER_MS
        previous = now
        placeTitle(element, Math.min(position, range), range)
        if (position < range) frame.current = requestAnimationFrame(step)
      }
      frame.current = requestAnimationFrame(step)
    },
    leave: (): void => {
      cancelAnimationFrame(frame.current)
      /* v8 ignore next -- defensive: the title span renders unconditionally. */
      if (title.current === null) return
      restTitle(title.current)
    },
  }), [title])
}

/**
 * Read a color out of a menu row id. The rows are built from WORKSPACE_COLORS,
 * so a known suffix is a real choice; `clear` and anything unrecognized yield
 * undefined, which clears the color rather than storing a value outside the union.
 * @param id - the selected row id, `appearance.color.<choice>`.
 * @returns the chosen color, or undefined to clear it.
 */
function workspaceColorOf(id: string): WorkspaceColor | undefined {
  const choice = id.slice('appearance.color.'.length)
  return choice === 'clear' ? undefined : WORKSPACE_COLORS.find(color => color === choice)
}

/**
 * Read an icon out of a menu row id, on the same terms as the color rows.
 * @param id - the selected row id, `appearance.icon.<choice>`.
 * @returns the chosen icon, or undefined to clear it.
 */
function workspaceIconOf(id: string): WorkspaceIcon | undefined {
  const choice = id.slice('appearance.icon.'.length)
  return choice === 'clear' ? undefined : WORKSPACE_ICONS.find(icon => icon === choice)
}

/**
 * The Color and Icon submenus every appearance entry point renders, so the row
 * ellipsis and the right-click menu cannot offer different choices.
 * @param t - the row's locale seat.
 * @returns the two submenu row lists, in menu order.
 */
function appearanceSubmenus(t: RowTranslate): { colors: readonly MenuItem[]; icons: readonly MenuItem[] } {
  return {
    colors: [
      { id: 'appearance.color.clear', label: t('appearance.default') },
      ...WORKSPACE_COLORS.map(color => ({
        id: `appearance.color.${color}`,
        label: t(`appearance.color.${color}`),
        icon: <span className={css.colorSwatch} style={{ background: WORKSPACE_APPEARANCE_COLORS[color] }} />,
      })),
    ],
    icons: [
      { id: 'appearance.icon.clear', label: t('appearance.default') },
      ...WORKSPACE_ICONS.map(icon => ({
        id: `appearance.icon.${icon}`,
        label: t(`appearance.icon.${icon}`),
        icon: <WorkspaceIconGlyph choice={icon} />,
      })),
    ],
  }
}

/**
 * Inline style painting a Workspace's chosen color onto its leading slot. The
 * row label inherits this color, so one declaration colors both the glyph and
 * the title; the default look leaves the slot to the stylesheet's alias.
 * @param appearance - the Workspace's chosen appearance, when it has one.
 * @returns the style to spread on the row, or undefined for the default look.
 */
function appearanceStyle(appearance: WorkspaceAppearance | undefined): { color: string } | undefined {
  return appearance?.color === undefined ? undefined : { color: WORKSPACE_APPEARANCE_COLORS[appearance.color] }
}

/** One Workspace icon choice rendered from the shared icon library. */
function WorkspaceIconGlyph({ choice }: { choice: WorkspaceIcon }) {
  const Glyph = WORKSPACE_ICON_GLYPHS[choice]
  return <Glyph size={16} />
}
/** Menu row id for one section choice. */
function sectionMenuItemId(sectionId: string): string {
  return `section.move.${sectionId}`
}

/** Menu row id for the ungrouped choice: removes the Chat from its section. */
const SECTION_UNGROUPED_ITEM = 'section.move.none'

/**
 * Resolve a section choice from a menu row id.
 * @param id - the selected menu row id.
 * @returns the target section id, null for the ungrouped choice, or undefined
 * for every other row (so no unrelated verb is read as a move).
 */
function sectionChoiceOf(id: string): string | null | undefined {
  if (id === SECTION_UNGROUPED_ITEM) return null
  if (!id.startsWith('section.move.')) return undefined
  return id.slice('section.move.'.length)
}

/**
 * The Move-to-Section submenu every Chat row offers, so a move stays available
 * when drag-and-drop is not. The owning section is listed but disabled, which
 * keeps the choice list stable while the current assignment stays visible; the
 * ungrouped row removes the Chat from its section without deleting it.
 * @param sections - every existing section in display order.
 * @param currentSectionId - the Chat's owning section, if any.
 * @param t - the row's locale seat.
 * @returns the submenu rows; their ids carry the choice back through onSelect.
 */
function sectionMenuItems(
  sections: readonly ChatSection[],
  currentSectionId: string | undefined,
  t: RowTranslate,
): MenuItem[] {
  return [
    ...sections.map(section => ({
      id: sectionMenuItemId(section.id),
      label: section.name,
      disabled: section.id === currentSectionId,
    })),
    { id: SECTION_UNGROUPED_ITEM, label: t('section.ungrouped'), disabled: currentSectionId === undefined },
  ]
}

/**
 * One Chat Section header row: disclosure chevron, title, member count, and
 * the section verbs (add chat, rename, delete). The header is the drop target
 * that assigns a dragged Chat to this section, so it reports its own hover
 * state through the drag wiring its list owner supplies.
 * @param props.section - derived section node.
 * @param props.dragActive - a compatible Chat or section drag is in flight.
 * @param props.marker - current drop marker: assign into, insert above, or none.
 * @param props.onToggle - collapse or expand the section.
 * @param props.onDragOver - report a hovered drop boundary.
 * @param props.onDrop - commit the drop on this header.
 * @param props.drag - optional section-row drag wiring (reorder).
 * @param props.actions - section verbs.
 * @param props.t - the browser root's locale seat.
 * @returns the section header element.
 */
export function SectionHeaderItem({
  section, appearance, dragActive = false, marker = null, onToggle, onDragOver, onDrop, onFileChat,
  externalChatSessionId = null, drag, actions, t,
}: {
  section: SectionNode
  appearance?: WorkspaceAppearance | undefined
  dragActive?: boolean | undefined
  marker?: 'before' | 'after' | 'inside' | null | undefined
  onToggle: () => void
  onDragOver?: ((half: 'before' | 'after') => void) | undefined
  onDrop?: ((half: 'before' | 'after') => void) | undefined
  onFileChat?: (() => void) | undefined
  externalChatSessionId?: string | null | undefined
  drag?: WorkspaceRowDragProps | undefined
  actions: {
    rename: () => void
    delete: () => void
    appearanceColor: (color: WorkspaceColor | undefined) => void
    appearanceIcon: (icon: WorkspaceIcon | undefined) => void
  }
  t: RowTranslate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const submenus = useMemo(() => appearanceSubmenus(t), [t])
  const items = [
    { id: 'appearance.color', label: t('appearance.color'), icon: <IconEditOutlineRegular />, submenu: submenus.colors },
    { id: 'appearance.icon', label: t('appearance.icon'), icon: <IconEditOutlineRegular />, submenu: submenus.icons },
    { id: 'rename', label: t('rename'), icon: <IconEditOutlineRegular /> },
    { id: 'delete', label: t('section.delete'), icon: <IconTrashOutlineRegular />, danger: true },
  ]
  const select = (id: string): void => {
    if (id.startsWith('appearance.color.')) actions.appearanceColor(workspaceColorOf(id))
    else if (id.startsWith('appearance.icon.')) actions.appearanceIcon(workspaceIconOf(id))
    else if (id === 'rename') actions.rename()
    else if (id === 'delete') actions.delete()
  }
  return (
    <div
      className={clsx(
        css.projectRow, css.sectionRow, menuOpen && css.menuOpen,
        marker === 'before' && css.dropBefore, marker === 'after' && css.dropAfter,
        marker === 'inside' && css.dropInside,
      )}
      style={appearanceStyle(appearance)}
      role="treeitem"
      aria-expanded={section.expanded}
      aria-label={t('section.actions.aria', { name: section.name })}
      onClick={onToggle}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenuOpen(false)
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
      draggable={drag !== undefined}
      onDragStart={drag === undefined
        ? undefined
        : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', section.id)
          drag.start()
        }}
      onDragEnd={drag?.end}
      onDragOver={(event) => {
        if (onFileChat !== undefined && externalChatSessionId !== null) {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'move'
          return
        }
        if (!dragActive) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        onDragOver?.(rowHalf(event))
      }}
      onDrop={(event) => {
        if (onFileChat !== undefined && externalChatSessionId !== null) {
          event.preventDefault()
          event.stopPropagation()
          onFileChat()
          return
        }
        if (!dragActive) return
        event.preventDefault()
        event.stopPropagation()
        onDrop?.(rowHalf(event))
      }}
    >
      <span className={clsx(css.slot, css.sectionGlyph)}>
        {appearance?.icon === undefined || appearance.icon === 'folder'
          ? section.expanded ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />
          : <WorkspaceIconGlyph choice={appearance.icon} />}
      </span>
      <span className={clsx(css.slot, css.chevron)}>
        <IconTriangleRightFillRegular className={clsx(css.arrow, section.expanded && css.arrowOpen)} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{section.name}</span>
      </span>
      <span className={css.sectionCount}>{t('section.count.other', { n: section.sessionCount })}</span>
      <span className={css.rowActions}>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={items}
          onSelect={(id) => { setMenuOpen(false); select(id) }}
          portal
          closeOnPointerLeave
          anchor={(
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('section.actions.aria', { name: section.name })}
              onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
            >
              <IconEllipsisOutlineRegular />
            </button>
          )}
        />
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('section.add')}
          onClick={(e) => { e.stopPropagation() }}
        >
          <IconPlusOutlineRegular />
        </button>
      </span>
      {contextMenu !== null && (
        <Menu
          open
          onClose={() => { setContextMenu(null) }}
          items={items}
          onSelect={(id) => { setContextMenu(null); select(id) }}
          portal
          getAnchorRect={() => DOMRect.fromRect({ x: contextMenu.x, y: contextMenu.y })}
          anchor={<span className={css.contextAnchor} />}
        />
      )}
    </div>
  )
}

/**
 * The Chat row menu's browser-local data rows: appearance choices plus the
 * section assignment when sections render. The row verbs (pin, rename, fork,
 * archive) are slot entries rendered after these rows. Both the hover menu and
 * the context menu are built here, so the two cannot offer different actions.
 * @param sectionActions - section assignment verbs, absent where sections do not render.
 * @param appearanceActions - appearance verbs, absent where the row has no appearance choice.
 * @param t - the row's locale seat.
 * @returns the data rows, without the selection handling its owners add.
 */
function sessionMenuItemsFor(
  sectionActions: SessionSectionActions | undefined,
  appearanceActions: SessionAppearanceActions | undefined,
  t: RowTranslate,
): MenuEntry[] {
  const submenus = appearanceSubmenus(t)
  const items: MenuItem[] = appearanceActions === undefined ? [] : [
    { id: 'appearance.color', label: t('appearance.color'), icon: <IconEditOutlineRegular />, submenu: submenus.colors },
    { id: 'appearance.icon', label: t('appearance.icon'), icon: <IconEditOutlineRegular />, submenu: submenus.icons },
  ]
  if (sectionActions !== undefined) {
    const { sections, currentSectionId } = sectionActions
    items.push({
      id: 'section.move',
      label: t('section.moveTo'),
      icon: <IconFolderCloseRegular />,
      submenu: sectionMenuItems(sections, currentSectionId, t),
    })
    if (currentSectionId !== undefined) {
      items.push({ id: 'section.remove', label: t('section.removeFrom'), icon: <IconFolderOpenRegular /> })
    }
  }
  // The hairline separates these browser-local rows from the slot entries
  // (the row verbs) the menu renders after them.
  return items.length === 0 ? [] : [...items, { type: 'separator', id: 'row-verbs-separator' }]
}

/**
 * One Chat row's section state plus the operations its menus apply. A context
 * menu outlives the render that opened it, so every verb reads only this value.
 */
export interface SessionSectionActions {
  /** Every existing section in display order. */
  sections: readonly ChatSection[]
  /** The Chat's owning section, or undefined while it is ungrouped. */
  currentSectionId: string | undefined
  /** Assign the Chat to a section, or to no section. */
  move: (sessionId: SessionNode['id'], sectionId: string | undefined) => void
}

/** One Chat row's appearance operations; undefined clears the choice. */
export interface SessionAppearanceActions {
  color: (color: WorkspaceColor | undefined) => void
  icon: (icon: WorkspaceIcon | undefined) => void
}

/** Localized compact relative time ("刚刚"/"5分钟" in zh, "now"/"5min" in en). */
function timeLabel(updatedAt: number, now: number, t: RowTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

/** Hover-card variant: distances wrap in the ago template; the now bucket stays bare (no "now ago"). */
function hoverTimeLabel(updatedAt: number, now: number, t: RowTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t('time.ago', { t: t(`time.${unit}`, { n }) })
}

/**
 * Absolute creation time through the dictionary's date template (the message
 * clock pattern): `toLocaleString` would follow the browser language, not the
 * app locale, and produce mixed-language text after a switch.
 */
function createdLabel(createdAt: number, t: RowTranslate): string {
  const d = new Date(createdAt)
  const pad2 = (v: number): string => String(v).padStart(2, '0')
  const date = t('date.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })
  return t('hover.created', { time: `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` })
}

/** Hover-card body: workspace title, display directory path, absolute creation time. */
function WorkspaceHoverContent({ label, cwd, createdAt, t }: {
  label: string
  cwd: string | undefined
  createdAt: number
  t: RowTranslate
}) {
  return (
    <div className={css.hoverContent}>
      <div className={css.hoverTitle}>{label}</div>
      <div className={css.hoverPath}>{cwd}</div>
      <div className={css.hoverTime}>{createdLabel(createdAt, t)}</div>
    </div>
  )
}

/**
 * Row drag wiring supplied by the tree owner. `drop` reports the half of the
 * row where the pointer released so the owner can resolve an insert anchor.
 */
export interface RowDragProps {
  /** Start dragging this row. */
  start: () => void
  /** A compatible row drag is in flight. */
  active: boolean
  /** Current marker on this row: insert line above, below, or none. */
  marker: 'before' | 'after' | null
  /** Report the hovered half while a compatible drag passes over this row. */
  hover: (half: 'before' | 'after') => void
  drop: (half: 'before' | 'after') => void
  end: () => void
}

/** Drag lifecycle owned by a workspace row; its enclosing group owns hit testing. */
interface WorkspaceRowDragProps {
  start: () => void
  end: () => void
}

/** Pointer-position half of a row (insert line above or below). */
function rowHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/**
 * Project (workspace) header row: folder + title;
 * hover reveals the chevron and create button, and dwelling on a real
 * Workspace shows its hover card (the ungrouped bucket has none).
 * `containsCurrent` arrives on the node (derivation fact, no renderer scan).
 * @param props.group - derived group node.
 * @param props.containsCurrentDescendant - highlight an ancestor even when its subtree is collapsed.
 * @param props.onToggle - expand/collapse the group.
 * @param props.onCreate - start a frontend Session inside this Workspace.
 * @param props.actions - real-Workspace menu verbs; absent for the ungrouped bucket.
 * @param props.appearance - the Workspace's chosen color and icon.
 * @param props.drag - optional workspace-row drag wiring.
 * @param props.home - host account home for POSIX hover-path abbreviation.
 * @param props.newShortcut - the New Session binding shown on the create button's tooltip.
 * @param props.t - the browser root's locale seat.
 * @returns the row element.
 */
export function ProjectRowItem({
  group, containsCurrentDescendant = false, onToggle, onCreate, actions, appearance, drag, home, newShortcut, t,
}: {
  group: GroupNode
  newShortcut?: ShortcutCatalogEntry | undefined
  containsCurrentDescendant?: boolean
  onToggle: () => void
  onCreate: () => void
  /** Real-Workspace actions; absent for the ungrouped bucket (no menu shown). */
  actions?: {
    rename: () => void
    delete: () => void
    appearance: () => void
    /** Apply a color straight from an inline menu row; undefined clears it. */
    appearanceColor: (color: WorkspaceColor | undefined) => void
    /** Apply an icon straight from an inline menu row; undefined clears it. */
    appearanceIcon: (icon: WorkspaceIcon | undefined) => void
  } | undefined
  /** The Workspace's chosen color and icon; absent for the default look. */
  appearance?: WorkspaceAppearance | undefined
  /** Present only for real Workspace rows in the grouped view. */
  drag?: WorkspaceRowDragProps | undefined
  /** Host account home; POSIX home-rooted hover paths display as `~`. */
  home?: string | undefined
  t: RowTranslate
}) {
  const row = group
  // The ungrouped bucket has no workspace title: its label is dictionary copy.
  const label = row.workspaceId === undefined ? t('group.ungrouped') : row.label
  const active = containsCurrentDescendant || (group.expanded && group.containsCurrent)
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  // A Workspace chooses its look inline. The dialog still exists for the
  // two-field case, but a menu row avoids the round trip entirely.
  const submenus = useMemo(() => appearanceSubmenus(t), [t])
  const workspaceMenuItems = [
    { id: 'appearance.color', label: t('appearance.color'), icon: <IconEditOutlineRegular />, submenu: submenus.colors },
    { id: 'appearance.icon', label: t('appearance.icon'), icon: <IconEditOutlineRegular />, submenu: submenus.icons },
    { id: 'appearance', label: t('appearance.customize'), icon: <IconEditOutlineRegular /> },
    { id: 'rename', label: t('rename'), icon: <IconEditOutlineRegular /> },
    { id: 'delete', label: t('delete.workspace'), icon: <IconTrashOutlineRegular />, danger: true },
  ]
  const ownRow = (
    <div
      className={clsx(css.projectRow, menuOpen && css.menuOpen)}
      style={appearanceStyle(appearance)}
      data-row-key={`workspace:${group.key}`}
      role="treeitem"
      aria-expanded={row.expanded}
      onClick={onToggle}
      onContextMenu={actions === undefined
        ? undefined
        : (e) => {
          // The browser menu would cover the row the choice applies to.
          e.preventDefault()
          e.stopPropagation()
          setMenuOpen(false)
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
      draggable={drag !== undefined}
      onDragStart={drag === undefined
        ? undefined
        : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', row.key)
          drag.start()
        }}
      onDragEnd={drag?.end}
    >
      <span className={clsx(css.slot, css.folder, active && appearance?.color === undefined && css.folderActive)}>
        {appearance?.icon === undefined || appearance.icon === 'folder'
          ? row.expanded ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />
          : <WorkspaceIconGlyph choice={appearance.icon} />}
      </span>
      <span className={clsx(css.slot, css.chevron)}>
        <IconTriangleRightFillRegular className={clsx(css.arrow, row.expanded && css.arrowOpen)} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{label}</span>
      </span>
      <span className={css.rowActions}>
        {actions !== undefined && (
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={workspaceMenuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              // Unknown ids leave before the dispatch: a future menu row must
              // not inherit the destructive branch as an else fallback.
              if (id === 'appearance') actions.appearance()
              else if (id.startsWith('appearance.color.')) actions.appearanceColor(workspaceColorOf(id))
              else if (id.startsWith('appearance.icon.')) actions.appearanceIcon(workspaceIconOf(id))
              else if (id === 'rename') actions.rename()
              else if (id === 'delete') actions.delete()
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('actions.workspace.aria', { name: label })}
                onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
              >
                <IconEllipsisOutlineRegular />
              </button>
            )}
          />
        )}
        <Tooltip label={t('actions.newSession')} shortcutKeys={newShortcut?.keys} side="bottom" align="end" delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-keyshortcuts={newShortcut?.aria}
            aria-label={t('actions.newSession.aria', { name: label })}
            onClick={(e) => { e.stopPropagation(); onCreate() }}
          >
            <IconNewChatOutlineRegular />
          </button>
        </Tooltip>
      </span>
      {contextMenu !== null && actions !== undefined && (
        <Menu
          open
          onClose={() => { setContextMenu(null) }}
          items={workspaceMenuItems}
          onSelect={(id) => {
            setContextMenu(null)
            if (id === 'appearance') actions.appearance()
            else if (id.startsWith('appearance.color.')) actions.appearanceColor(workspaceColorOf(id))
            else if (id.startsWith('appearance.icon.')) actions.appearanceIcon(workspaceIconOf(id))
            else if (id === 'rename') actions.rename()
            else if (id === 'delete') actions.delete()
          }}
          portal
          getAnchorRect={() => DOMRect.fromRect({ x: contextMenu.x, y: contextMenu.y })}
          anchor={<span className={css.contextAnchor} />}
        />
      )}
    </div>
  )
  // The ungrouped bucket has no backing Workspace: no card to show.
  if (row.createdAt === undefined) return ownRow
  return (
    <HoverCard
      anchor={ownRow}
      content={<WorkspaceHoverContent
        label={row.label}
        cwd={row.cwd === undefined ? undefined : abbreviateHomePath(row.cwd, home)}
        createdAt={row.createdAt}
        t={t}
      />}
      openDelayMs={800}
      disabled={menuOpen || contextMenu !== null}
      copyText={row.cwd}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}

/** Non-interactive pinned-row marker; the enclosing row remains the only action. */
function PinnedIndicator({ t }: { t: RowTranslate }) {
  const label = t('row.pinned')
  return (
    <span className={css.pinIndicator} role="img" aria-label={label} title={label}>
      <IconPinFillRegular size={14} />
    </span>
  )
}

/**
 * Hover-card body: full title, relative time, the Session's own scheduled-task
 * section, and every relevant live status. The task section sits above the
 * status lines so they stay the card's trailing status line.
 */
function SessionHoverContent({ node, now, renderSlot, t }: {
  node: SessionNode
  now: number
  renderSlot: RowRenderSlots
  t: RowTranslate
}) {
  // On archived rows the archived line already says the session is inactive,
  // so resting statuses (idle/completed) drop; live activity still shows.
  const statuses = sessionStatuses(node, t)
    .filter(status => !(node.archived && (status.state === 'done' || status.state === 'idle')))
  return (
    <div className={css.hoverContent}>
      <div className={css.hoverTitle}>{displayTitle(node, t)}</div>
      {/* Same placeholder rule as the row's trailing cell: no timestamp
          before the first prompt. */}
      {!node.blank && <div className={css.hoverTime}>{hoverTimeLabel(node.updatedAt, now, t)}</div>}
      {renderSlot('sidebar.session.row.hover', { sessionId: node.id })}
      {statuses.map(status => (
        <div className={css.hoverStatus} key={status.label}>
          <StateDot state={status.state} />
          <span>{status.label}</span>
        </div>
      ))}
      {node.archived && (
        <div className={clsx(css.hoverStatus, css.hoverArchived)}>
          <IconArchiveOutlineRegular size={14} />
          <span>{t('row.archived')}</span>
        </div>
      )}
    </div>
  )
}

/**
 * One flat search result: title, Workspace context, and optional content
 * excerpt. Search navigation opens the session only; it does not address an
 * event inside the conversation. Archived rows carry a hover unarchive
 * button, because search is where the filter surfaces them for recovery.
 * @param props.result - merged local/content search row.
 * @param props.currentId - selected session id.
 * @param props.onOpen - open the selected session.
 * @param props.onUnarchive - unarchive an archived result row.
 * @param props.t - Workspace-browser translation seat.
 * @returns the result row.
 */
export function SearchResultItem({ result, currentId, onOpen, onUnarchive, t }: {
  result: SearchResultNode
  currentId: string | undefined
  onOpen: (id: SearchResultNode['id']) => void
  onUnarchive: (id: SearchResultNode['id']) => void
  t: RowTranslate
}) {
  const selected = result.id === currentId
  const statuses = sessionStatuses(result, t)
  const primaryStatus = statuses[0]
  return (
    <div
      className={clsx(css.searchResultRow, selected && css.selected, result.archived && css.archived)}
      role="treeitem"
      aria-selected={selected}
      aria-description={result.archived ? t('toast.archivedNotOpenable') : undefined}
      onClick={() => { onOpen(result.id) }}
    >
      <span className={css.searchResultHeading}>
        {/* Like session rows, the leading slot owns every row marker; on
            archived rows it stays blank — the grayed row carries the
            archived look. */}
        <span className={css.slot}>
          {!result.archived && primaryStatus.state !== 'idle' && (
            <SessionStatusDots statuses={statuses} />
          )}
        </span>
        <span className={css.searchResultTitle}>{result.title}</span>
        {result.archived && (
          <span className={css.rowActions}>
            <Tooltip label={t('actions.unarchive')} side="bottom" align="end" delayMs={500}>
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('menu.unarchiveSession')}
                onClick={(e) => { e.stopPropagation(); onUnarchive(result.id) }}
              >
                <IconUnarchiveOutlineRegular size={14} />
              </button>
            </Tooltip>
          </span>
        )}
      </span>
      <span className={css.searchResultMeta}>
        <span className={css.searchResultWorkspace}>{result.workspace || t('group.ungrouped')}</span>
        {result.snippet !== undefined && (
          <span className={css.searchResultSnippet}>{result.snippet}</span>
        )}
      </span>
    </div>
  )
}

/**
 * One top-level 32px session row: leading 16px cell (status dot, or the
 * leading seat while the row's primary state is idle), title, relative time or
 * compact pending label, and the row actions menu. A row that owns a state dot
 * keeps that cell and renders no seat, so an ambient automation mark never
 * appears beside the row's own state dot. An archived row keeps the cell blank:
 * neither marker renders there, and its live status stays on the hover card.
 * @param props.node - derived session node.
 * @param props.currentId - selected session id (row highlight).
 * @param props.now - epoch ms for relative-time formatting.
 * @param props.onOpen - open a session by id.
 * @param props.onRenameRequest - open the rename dialog from a title double-click (id + current title).
 * @param props.renderSlot - child-seat renderer for the row's action lists
 * (`sidebar.workspaces.session.menu.item` / `sidebar.workspaces.session.row.action`),
 * its leading decoration, and its hover-card section.
 * @param props.onReveal - scroll this row into view after search navigation, then acknowledge it.
 * @param props.drag - optional row-drag target wiring; blank rows cannot start a drag.
 * @param props.appearance - the owning Workspace's appearance merged with the row's own choice.
 * @param props.appearanceActions - appearance verbs offered in the row menus.
 * @param props.sectionActions - section assignment verbs, present only where sections render.
 * @param props.t - the browser root's locale seat.
 * @returns the session row.
 */
export function SessionNodeItem({
  node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, appearance,
  appearanceActions, sectionActions, t,
}: {
  node: SessionNode
  currentId: string | undefined
  now: number
  onOpen: (id: SessionNode['id']) => void
  /** Open the rename dialog from a title double-click (id + current title). */
  onRenameRequest: (id: SessionNode['id'], currentTitle: string) => void
  /** Scroll this row into view after search navigation, then acknowledge it. */
  onReveal?: (() => void) | undefined
  /** Present on reorderable-list rows so every row can remain a drop target. */
  drag?: RowDragProps | undefined
  /**
   * The owning Workspace's appearance. Its icon leads the session title so a
   * session stays identified with the Workspace it belongs to, and its color
   * rides on that same glyph.
   */
  appearance?: WorkspaceAppearance | undefined
  appearanceActions?: SessionAppearanceActions | undefined
  /**
   * Section assignment for this row. Absent wherever sections do not render,
   * which leaves the row's menus without the section rows.
   */
  sectionActions?: SessionSectionActions | undefined
  t: RowTranslate
} & PropsRenderSlots<
  | 'sidebar.workspaces.session.menu.item'
  | 'sidebar.workspaces.session.row.action'
  | 'sidebar.session.row.leading'
  | 'sidebar.session.row.hover'
>) {
  const row = node
  const title = displayTitle(node, t)
  const selected = node.id === currentId
  const statuses = sessionStatuses(node, t)
  const primaryStatus = statuses[0]
  const showStatus = primaryStatus.state !== 'idle'
  // Live work reads as text beside the title; states with a compact trailing
  // label already say so in the time cell.
  const showStatusLabel = !row.blank && !row.archived && primaryStatus.trailingLabel === undefined
    && (row.running || row.runningSubagentCount > 0)
  // The folder choice is the default look and gets no session-level mark; any
  // other choice leads the title so the row reads as part of that Workspace.
  const iconChoice = appearance?.icon
  const sessionGlyph = iconChoice === undefined || iconChoice === 'folder'
    ? undefined
    : <WorkspaceIconGlyph choice={iconChoice} />
  // Archived rows hold their in-place grayed slot, so manual reorder cannot
  // move them. Pinned rows drag within the pinned block: the browser gates
  // their drop targets to fellow pinned rows.
  const draggable = drag !== undefined && !row.blank && !row.archived
  const [menuOpen, setMenuOpen] = useState(false)
  // The menu's open state, bound into the row entries' `useMenuOpenState` hook.
  const menuOpenState = useMemo((): MenuOpenState => [menuOpen, setMenuOpen], [menuOpen])
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  // The pointer-anchored copy of the same menu binds its own open state, so an
  // entry's `setOpen(false)` dismisses whichever menu it sits in.
  const contextMenuOpenState = useMemo((): MenuOpenState => [
    contextMenu !== null,
    (open) => { if (!open) setContextMenu(null) },
  ], [contextMenu])
  const rowRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const marquee = useTitleMarquee(titleRef)
  useEffect(() => {
    if (onReveal === undefined) return
    rowRef.current?.scrollIntoView({ block: 'nearest' })
    onReveal()
  }, [onReveal])
  const sessionMenuItems = sessionMenuItemsFor(sectionActions, appearanceActions, t)
  /**
   * Apply one data-row selection. The hover menu and the context menu share
   * this, so they cannot diverge; the slot entries act on their own.
   * @param id - the selected row id.
   */
  const selectMenuRow = (id: string): void => {
    if (id.startsWith('appearance.color.')) { appearanceActions?.color(workspaceColorOf(id)); return }
    if (id.startsWith('appearance.icon.')) { appearanceActions?.icon(workspaceIconOf(id)); return }
    if (id === 'section.remove') { sectionActions?.move(node.id, undefined); return }
    const choice = sectionChoiceOf(id)
    if (choice === undefined) return
    sectionActions?.move(node.id, choice ?? undefined)
  }
  // Figma session cell: pad 8, status slot 16, then a 4px title gap.
  const ownRow = (
    <div
      ref={rowRef}
      data-row-key={`session:${node.id}`}
      className={clsx(
        css.sessionRow, selected && css.selected, menuOpen && css.menuOpen,
        row.archived && css.archived,
        drag?.marker === 'before' && css.dropBefore, drag?.marker === 'after' && css.dropAfter,
      )}
      style={appearanceStyle(appearance)}
      role="treeitem"
      aria-selected={selected}
      aria-description={row.archived ? t('toast.archivedNotOpenable') : undefined}
      onClick={() => { onOpen(node.id) }}
      onContextMenu={row.blank
        ? undefined
        : (e) => {
          // A provisional New Session row has no content for the row verbs to
          // act on, so it keeps the browser menu like it keeps its verbs.
          e.preventDefault()
          e.stopPropagation()
          setMenuOpen(false)
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
      onPointerEnter={marquee.enter}
      onPointerLeave={marquee.leave}
      draggable={draggable}
      onDragStart={!draggable
        ? undefined
        : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', node.id)
          drag.start()
        }}
      onDragEnd={!draggable ? undefined : drag.end}
      onDragOver={drag === undefined
        ? undefined
        : (e) => {
          if (!drag.active) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          drag.hover(rowHalf(e))
        }}
      onDrop={drag === undefined
        ? undefined
        : (e) => {
          if (!drag.active) return
          e.preventDefault()
          drag.drop(rowHalf(e))
        }}
    >
      {/* Pending interaction and own or descendant activity outrank the
          finished-but-unviewed reminder, which returns after activity stops
          and is cleared by opening the session. Archived rows keep the slot
          blank — the grayed row carries the archived look — and their live
          status stays on the hover card only. */}
      <span className={css.slot}>
        {!row.archived && !row.blank && (showStatus
          ? <SessionStatusDots statuses={statuses} visiblePrimary={showStatusLabel} />
          : renderSlot('sidebar.session.row.leading', { sessionId: node.id }))}
      </span>
      {sessionGlyph !== undefined && (
        <span className={clsx(css.slot, css.sessionGlyph)} style={appearanceStyle(appearance)}>
          {sessionGlyph}
        </span>
      )}
      <span
        ref={titleRef}
        className={css.title}
        onDoubleClick={row.blank
          ? undefined
          : (e) => { e.stopPropagation(); onRenameRequest(node.id, row.title) }}
      >
        {title}
      </span>
      {showStatusLabel && <span className={css.statusLabel}>{primaryStatus.label}</span>}
      {/* A blank New Session row is a provisional placeholder: nothing has
          happened in it yet, so a "now" timestamp and the row verbs
          (rename/fork/archive) would all act on content that does not
          exist — both trailing cells stay off until the first prompt. */}
      {!row.blank && (
        <span
          className={css.time}
          aria-hidden={primaryStatus.trailingLabel === undefined ? undefined : true}
        >
          {primaryStatus.trailingLabel ?? timeLabel(row.updatedAt, now, t)}
        </span>
      )}
      {/* Trails the time so the marker occupies the same right-edge cell as
          the hover pin button that replaces it. */}
      {row.pinned && !row.archived && <PinnedIndicator t={t} />}
      {/* The strip's clicks stay in the strip: the trigger and every
          row.action entry act without also opening the row, so an entry's
          button needs no propagation handling of its own. */}
      {!row.blank && (
        <span className={css.rowActions} onClick={(e) => { e.stopPropagation() }}>
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={sessionMenuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              selectMenuRow(id)
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('actions.session.aria', { name: title })}
                onClick={() => { setMenuOpen(v => !v) }}
              >
                <IconEllipsisOutlineRegular />
              </button>
            )}
          >
            {renderSlot(
              'sidebar.workspaces.session.menu.item',
              { sessionId: node.id, displayTitle: row.title },
              { hookContext: menuOpenState },
            )}
          </Menu>
          {renderSlot('sidebar.workspaces.session.row.action', { sessionId: node.id, displayTitle: row.title })}
        </span>
      )}
      {contextMenu !== null && !row.blank && (
        <Menu
          open
          onClose={() => { setContextMenu(null) }}
          items={sessionMenuItems}
          onSelect={(id) => {
            setContextMenu(null)
            selectMenuRow(id)
          }}
          portal
          getAnchorRect={() => DOMRect.fromRect({ x: contextMenu.x, y: contextMenu.y })}
          anchor={<span className={css.contextAnchor} />}
        >
          {renderSlot(
            'sidebar.workspaces.session.menu.item',
            { sessionId: node.id, displayTitle: row.title },
            { hookContext: contextMenuOpenState },
          )}
        </Menu>
      )}
    </div>
  )
  return (
    <HoverCard
      anchor={ownRow}
      content={<SessionHoverContent node={node} now={now} renderSlot={renderSlot} t={t} />}
      openDelayMs={800}
      disabled={menuOpen || contextMenu !== null || drag?.active === true}
      copyText={row.blank ? undefined : row.title}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}
