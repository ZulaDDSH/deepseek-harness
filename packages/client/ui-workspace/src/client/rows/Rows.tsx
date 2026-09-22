/**
 * Workspace browser tree row components (figma Cell set 14:3080): pure presentational —
 * all data and callbacks arrive via props. Hover swaps (folder->chevron,
 * time->ellipsis, action buttons) are CSS-only, and a session row's clipped
 * title is scrolled programmatically while the row is hovered. Row ... menus are
 * visual-only except workspace Rename/Delete and session Rename/Fork/Archive; the
 * session and workspace hover cards are suppressed while a menu is open.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  HoverCard, IconAlarmClockOutline16, IconArchiveOutline20, IconBranchOutline16,
  IconEditOutline16, IconEllipsisOutline16, IconFolderClose16, IconFolderOpen16,
  IconPlusOutline16, IconTrashOutline16, IconTriangleRightFill14, Menu, relativeTime,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import { abbreviateHomePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { WorkspaceAppearance, WorkspaceColor, WorkspaceIcon } from '../appearance.ts'
import type { SectionNode } from '../sections.ts'
import type { ChatSection } from '../stores.ts'
import type { GroupNode, SearchResultNode, SessionNode } from '../tree.ts'
import {
  appearanceStyle, appearanceSubmenus, workspaceColorOf, workspaceIconOf, WorkspaceIconGlyph,
} from './WorkspaceAppearance.tsx'
import type { SessionAppearanceActions } from './WorkspaceAppearance.tsx'
import css from './Rows.module.css'

export type { SessionAppearanceActions } from './WorkspaceAppearance.tsx'

/**
 * One Chat row's section state plus the operation its menus apply. A context
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

/** The standard locale seat, prop-passed from the browser root. */
type RowTranslate = WorkspaceBrowserProps['t']

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
 * One Chat Section header row: disclosure chevron, title, member count, and the
 * section verbs (rename, delete, appearance). The header is the drop target that
 * assigns a dragged Chat to this section, so it reports its own hover state
 * through the drag wiring its list owner supplies.
 * @param props.section - derived section node.
 * @param props.appearance - the section's chosen color and icon, when it has one.
 * @param props.dragActive - a compatible Chat or section drag is in flight.
 * @param props.marker - current drop marker: assign into, insert above, or none.
 * @param props.onToggle - collapse or expand the section.
 * @param props.onDragOver - report a hovered drop boundary.
 * @param props.onDrop - commit the drop on this header.
 * @param props.onFileChat - file an externally dragged Chat into this section.
 * @param props.externalChatSessionId - the Chat dragged in from the Workspace pane.
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
    { id: 'appearance.color', label: t('appearance.color'), icon: <IconEditOutline16 />, submenu: submenus.colors },
    { id: 'appearance.icon', label: t('appearance.icon'), icon: <IconEditOutline16 />, submenu: submenus.icons },
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'delete', label: t('section.delete'), icon: <IconTrashOutline16 />, danger: true },
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
          ? section.expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />
          : <WorkspaceIconGlyph choice={appearance.icon} />}
      </span>
      <span className={clsx(css.slot, css.chevron)}>
        <IconTriangleRightFill14 className={clsx(css.arrow, section.expanded && css.arrowOpen)} />
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
              <IconEllipsisOutline16 />
            </button>
          )}
        />
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

/** Row display title: blank rows show the localized New Session label. */
function displayTitle(node: SessionNode, t: RowTranslate): string {
  return node.blank ? t('session.new') : node.title
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
 * @param props.appearance - the Workspace's chosen color and icon, absent for the default look.
 * @param props.drag - optional workspace-row drag wiring.
 * @param props.home - host account home for POSIX hover-path abbreviation.
 * @param props.t - the browser root's locale seat.
 * @returns the row element.
 */
export function ProjectRowItem({ group, containsCurrentDescendant = false, onToggle, onCreate, actions, appearance, drag, home, t }: {
  group: GroupNode
  containsCurrentDescendant?: boolean
  onToggle: () => void
  onCreate: () => void
  /** Real-Workspace actions; absent for the ungrouped bucket (no menu shown). */
  actions?: {
    rename: () => void
    delete: () => void
    /** Open the browser-owned appearance editor for this Workspace. */
    appearance: () => void
    /** Apply a color straight from an inline menu row; undefined clears it. */
    appearanceColor: (color: WorkspaceColor | undefined) => void
    /** Apply an icon straight from an inline menu row; undefined clears it. */
    appearanceIcon: (icon: WorkspaceIcon | undefined) => void
  } | undefined
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
    { id: 'appearance.color', label: t('appearance.color'), icon: <IconEditOutline16 />, submenu: submenus.colors },
    { id: 'appearance.icon', label: t('appearance.icon'), icon: <IconEditOutline16 />, submenu: submenus.icons },
    { id: 'appearance', label: t('appearance.customize'), icon: <IconEditOutline16 /> },
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'delete', label: t('delete.workspace'), icon: <IconTrashOutline16 />, danger: true },
  ]
  const ownRow = (
    <div
      className={clsx(css.projectRow, menuOpen && css.menuOpen)}
      style={appearanceStyle(appearance)}
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
      <span className={clsx(css.slot, css.folder, active && (appearance?.color === undefined && css.folderActive))}>
        {appearance?.icon === undefined || appearance.icon === 'folder'
          ? row.expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />
          : <WorkspaceIconGlyph choice={appearance.icon} />}
      </span>
      <span className={clsx(css.slot, css.chevron)}>
        <IconTriangleRightFill14 className={clsx(css.arrow, row.expanded && css.arrowOpen)} />
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
              /* v8 ignore next -- Menu can emit only the rows supplied above. */
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
                <IconEllipsisOutline16 />
              </button>
            )}
          />
        )}
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('actions.newSession.aria', { name: label })}
          onClick={(e) => { e.stopPropagation(); onCreate() }}
        >
          <IconPlusOutline16 />
        </button>
      </span>
      {contextMenu !== null && actions !== undefined && (
        <Menu
          open
          onClose={() => { setContextMenu(null) }}
          items={workspaceMenuItems}
          onSelect={(id) => {
            setContextMenu(null)
            if (id.startsWith('appearance.color.')) actions.appearanceColor(workspaceColorOf(id))
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
      disabled={menuOpen || contextMenu !== null}
      copyText={row.cwd}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}

/* v8 ignore next 3 -- closed-union backstop; only reached if the status is forged */
function assertNever(value: never): never {
  throw new Error(`unknown pending interaction: ${String(value)}`)
}

interface SessionStatus {
  state: StateDotState
  label: string
}

/**
 * Session status presentation; pending interaction is primary and live activity
 * outranks completion reminders.
 */
function sessionStatuses(
  node: Pick<SessionNode, 'pendingInteraction' | 'running' | 'runningSubagentCount' | 'completed'>,
  t: RowTranslate,
): readonly [SessionStatus, ...SessionStatus[]] {
  const subagents: SessionStatus | undefined = node.runningSubagentCount === 0
    ? undefined
    : {
      state: 'ongoing',
      label: t(
        node.runningSubagentCount === 1
          ? 'status.subagentsRunning.one'
          : 'status.subagentsRunning.other',
        { n: node.runningSubagentCount },
      ),
    }
  let pending: SessionStatus | undefined
  switch (node.pendingInteraction) {
    case 'approval':
      pending = { state: 'warning', label: t('status.waitingApproval') }
      break
    case 'plan-review':
      pending = { state: 'warning', label: t('status.planReview') }
      break
    case 'question':
      pending = { state: 'warning', label: t('status.waitingAnswer') }
      break
    case undefined: break
    /* v8 ignore next -- closed PendingInteractionStatus union */
    default: return assertNever(node.pendingInteraction)
  }
  if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents]
  if (node.running) {
    const primary: SessionStatus = { state: 'ongoing', label: t('status.running') }
    return subagents === undefined ? [primary] : [primary, subagents]
  }
  if (subagents !== undefined) return [subagents]
  if (node.completed) return [{ state: 'done', label: t('status.completed') }]
  return [{ state: 'done', label: t('status.idle') }]
}

/** Primary status dot plus every status's screen-reader label, shared by the search and session rows. */
function SessionStatusDots({ statuses }: { statuses: readonly [SessionStatus, ...SessionStatus[]] }) {
  return (
    <>
      <StateDot state={statuses[0].state} />
      {statuses.map(status => (
        <span className={css.visuallyHidden} key={status.label}>{status.label}</span>
      ))}
    </>
  )
}

/** Non-interactive active-Schedule marker; the enclosing row remains the only action. */
function ActiveScheduleIndicator({ t, search = false }: { t: RowTranslate; search?: boolean }) {
  const label = t('schedule.active')
  return (
    <span
      className={clsx(css.scheduleIndicator, search && css.searchScheduleIndicator)}
      role="img"
      aria-label={label}
      title={label}
    >
      <IconAlarmClockOutline16 />
    </span>
  )
}

/** Hover-card body: full title, relative time, and every relevant live status. */
function SessionHoverContent({ node, now, t }: { node: SessionNode; now: number; t: RowTranslate }) {
  const statuses = sessionStatuses(node, t)
  return (
    <div className={css.hoverContent}>
      <div className={css.hoverTitle}>{displayTitle(node, t)}</div>
      {/* Same placeholder rule as the row's trailing cell: no timestamp
          before the first prompt. */}
      {!node.blank && <div className={css.hoverTime}>{hoverTimeLabel(node.updatedAt, now, t)}</div>}
      {statuses.map(status => (
        <div className={css.hoverStatus} key={status.label}>
          <StateDot state={status.state} />
          <span>{status.label}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * One flat search result: title, Workspace context, and optional content
 * excerpt. Search navigation opens the session only; it does not address an
 * event inside the conversation.
 * @param props.result - merged local/content search row.
 * @param props.currentId - selected session id.
 * @param props.onOpen - open the selected session.
 * @param props.t - Workspace-browser translation seat.
 * @returns the result button.
 */
export function SearchResultItem({ result, currentId, onOpen, t }: {
  result: SearchResultNode
  currentId: string | undefined
  onOpen: (id: SearchResultNode['id']) => void
  t: RowTranslate
}) {
  const selected = result.id === currentId
  const statuses = sessionStatuses(result, t)
  const primaryStatus = statuses[0]
  return (
    <button
      type="button"
      className={clsx(css.searchResultRow, selected && css.selected)}
      role="treeitem"
      aria-selected={selected}
      onClick={() => { onOpen(result.id) }}
    >
      <span className={css.searchResultHeading}>
        <span className={css.slot}>
          {(primaryStatus.state !== 'done' || result.completed) && (
            <SessionStatusDots statuses={statuses} />
          )}
        </span>
        <span className={css.searchResultTitle}>{result.title}</span>
        {result.hasActiveSchedule && <ActiveScheduleIndicator t={t} search />}
      </span>
      <span className={css.searchResultMeta}>
        <span className={css.searchResultWorkspace}>{result.workspace || t('group.ungrouped')}</span>
        {result.snippet !== undefined && (
          <span className={css.searchResultSnippet}>{result.snippet}</span>
        )}
      </span>
    </button>
  )
}

/**
 * One top-level 34px session row: status dot (pending user interaction outranks
 * own or descendant activity), title, relative time, and the row actions menu.
 * @param props.node - derived session node.
 * @param props.currentId - selected session id (row highlight).
 * @param props.now - epoch ms for relative-time formatting.
 * @param props.onOpen - open a session by id.
 * @param props.onRename - open the session rename dialog (id + current title).
 * @param props.onFork - fork a session at its last completed turn.
 * @param props.onArchive - archive a session by id.
 * @param props.onReveal - scroll this row into view after search navigation, then acknowledge it.
 * @param props.drag - optional row-drag target wiring; blank rows cannot start a drag.
 * @param props.flat - omit the empty status slot in the hierarchy-free flat list.
 * @param props.appearance - the owning Workspace's appearance, which colors and marks this row.
 * @param props.appearanceActions - this session's own appearance verbs, absent where the row offers none.
 * @param props.sectionActions - section assignment verbs, present only where sections render.
 * @param props.t - the browser root's locale seat.
 * @returns the session row.
 */
export function SessionNodeItem({
  node, currentId, now, onOpen, onRename, onFork, onArchive, onReveal, drag, flat = false, appearance,
  appearanceActions, sectionActions, t,
}: {
  node: SessionNode
  currentId: string | undefined
  now: number
  onOpen: (id: SessionNode['id']) => void
  /** Open the browser-owned session rename dialog (row menu action). */
  onRename: (id: SessionNode['id'], currentTitle: string) => void
  /** Fork a session at its last completed turn (row menu action). */
  onFork: (id: SessionNode['id']) => void
  /** Archive this session (row menu action; commits without a dialog). */
  onArchive: (id: SessionNode['id']) => void
  /** Scroll this row into view after search navigation, then acknowledge it. */
  onReveal?: (() => void) | undefined
  /** Present on reorderable-list rows so every row can remain a drop target. */
  drag?: RowDragProps | undefined
  /** The row is rendered without a parent Workspace header. */
  flat?: boolean | undefined
  /**
   * The owning Workspace's appearance. Its icon leads the session title so a
   * session stays identified with the Workspace it belongs to, and its color
   * rides on that same glyph rather than recoloring the title.
   */
  appearance?: WorkspaceAppearance | undefined
  appearanceActions?: SessionAppearanceActions | undefined
  /**
   * Section assignment for this row. Absent wherever sections do not render,
   * which leaves the row's menus exactly as they were.
   */
  sectionActions?: SessionSectionActions | undefined
  t: RowTranslate
}) {
  const row = node
  const title = displayTitle(node, t)
  const selected = node.id === currentId
  const statuses = sessionStatuses(node, t)
  const primaryStatus = statuses[0]
  const showStatus = primaryStatus.state !== 'done' || row.completed
  const draggable = drag !== undefined && !row.blank
  // The folder choice is the default look and gets no session-level mark; any
  // other choice leads the title so the row reads as part of that Workspace.
  const iconChoice = appearance?.icon
  const sessionGlyph = iconChoice === undefined || iconChoice === 'folder'
    ? undefined
    : <WorkspaceIconGlyph choice={iconChoice} />
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (onReveal === undefined) return
    rowRef.current?.scrollIntoView({ block: 'nearest' })
    onReveal()
  }, [onReveal])
  // Archive hides the row through the registry-global archive set and never
  // touches the session log, so it is not styled as destructive and needs no
  // confirmation dialog.
  const submenus = appearanceSubmenus(t)
  const sessionMenuItems: MenuItem[] = [
    ...(appearanceActions === undefined ? [] : [
      { id: 'appearance.color', label: t('appearance.color'), icon: <IconEditOutline16 />, submenu: submenus.colors },
      { id: 'appearance.icon', label: t('appearance.icon'), icon: <IconEditOutline16 />, submenu: submenus.icons },
    ]),
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'fork', label: t('menu.fork'), icon: <IconBranchOutline16 /> },
    // 20-native glyph in the menu's 16px icon slot (Menu.module.css .itemIcon).
    { id: 'archive', label: t('menu.archiveSession'), icon: <IconArchiveOutline20 size={16} /> },
  ]
  if (sectionActions !== undefined) {
    const { sections, currentSectionId } = sectionActions
    sessionMenuItems.push({
      id: 'section.move',
      label: t('section.moveTo'),
      icon: <IconFolderClose16 />,
      submenu: sectionMenuItems(sections, currentSectionId, t),
    })
    if (currentSectionId !== undefined) {
      sessionMenuItems.push({
        id: 'section.remove', label: t('section.removeFrom'), icon: <IconFolderOpen16 />,
      })
    }
  }
  /**
   * Apply one row-menu selection. The hover menu and the context menu both
   * route here, so the two cannot offer different verbs.
   * @param id - the selected row id.
   */
  const selectMenuRow = (id: string): void => {
    if (id === 'rename') { onRename(node.id, row.title); return }
    if (id === 'fork') { onFork(node.id); return }
    if (id === 'archive') { onArchive(node.id); return }
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
      className={clsx(
        css.sessionRow, selected && css.selected, menuOpen && css.menuOpen,
        flat && !showStatus && css.flatSessionRowWithoutStatus,
        drag?.marker === 'before' && css.dropBefore, drag?.marker === 'after' && css.dropAfter,
      )}
      style={appearanceStyle(appearance)}
      role="treeitem"
      aria-selected={selected}
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
      draggable={draggable}
      onDragStart={drag === undefined || row.blank
        ? undefined
        : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', node.id)
          drag.start()
        }}
      onDragEnd={drag === undefined || row.blank ? undefined : drag.end}
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
          and is cleared by opening the session. */}
      {(!flat || showStatus) && (
        <span className={css.slot}>
          {showStatus && <SessionStatusDots statuses={statuses} />}
        </span>
      )}
      {sessionGlyph !== undefined && (
        <span className={clsx(css.slot, css.sessionGlyph)} style={appearanceStyle(appearance)}>
          {sessionGlyph}
        </span>
      )}
      <span className={css.title}>{title}</span>
      {row.hasActiveSchedule && <ActiveScheduleIndicator t={t} />}
      {/* A blank New Session row is a provisional placeholder: nothing has
          happened in it yet, so a "now" timestamp and the row verbs
          (rename/fork/archive) would all act on content that does not
          exist — both trailing cells stay off until the first prompt. */}
      {!row.blank && <span className={css.time}>{timeLabel(row.updatedAt, now, t)}</span>}
      {!row.blank && (
        <span className={css.rowActions}>
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
                onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
              >
                <IconEllipsisOutline16 />
              </button>
            )}
          />
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
        />
      )}
    </div>
  )
  return (
    <HoverCard
      anchor={ownRow}
      content={<SessionHoverContent node={node} now={now} t={t} />}
      disabled={menuOpen || contextMenu !== null || drag?.active === true}
      copyText={row.blank ? undefined : row.title}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}
