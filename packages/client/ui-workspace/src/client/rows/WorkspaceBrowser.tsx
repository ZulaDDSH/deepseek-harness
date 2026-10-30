/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders the two
 * region icons (search / add workspace) as 36px controls on the shell's shared
 * rail entry path, each requesting expansion through the owner share. Adding
 * is the header button's one action, so it raises the directory flow with no
 * menu in between; the flow and its error dialog live in WorkspacePicker
 * (same package — direct composition, no slot between them). A Session row's
 * "..." menu and hover buttons are the `sidebar.workspaces.session.menu.item`
 * and `sidebar.workspaces.session.row.action` lists rendered through this
 * entry's `renderSlot`; the actions in them, this package's own included,
 * are slot entries with their own behavior, so this component threads no
 * action callbacks and hosts no action surface. The Chat Sections pane lives
 * here and persists with the browser's view state.
 */
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { WorkspaceDialogs } from './WorkspaceDialogs.tsx'
import {
  AnimatedRows, HoverCardGroup, IconArchiveCheckOutlineRegular, IconArchiveOffOutlineRegular, IconArchiveOutlineRegular,
  IconChevronsUpDownOutlineRegular, IconClockOutlineRegular, IconCloseFillRegular,
  IconFlatListOutlineRegular, IconFolderCloseRegular, IconGaugeOutlineRegular, IconPlusOutlineRegular,
  IconProjectAddOutlineRegular, IconQueueOutlineRegular, IconSearchOutlineRegular, IconSlidersTwoOutlineRegular,
  IconWorkspaceTreeOutlineRegular, Menu, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionListState, SessionSearchResultItem,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import { WORKSPACE_COLORS, WORKSPACE_ICONS } from '../appearance.ts'
import type { WorkspaceAppearance, WorkspaceColor, WorkspaceIcon } from '../appearance.ts'
import type { ArchivedFilter, GroupAttention, GroupNode, SessionNode, SessionOrderBy, SessionRowState } from '../tree.ts'
import {
  deriveFlat, deriveGroups, deriveSearchResults, mergeAttention, orderByRecency, owningGroupKey, owningParentFolder,
  pinCurrentBlank, reconcileManualOrder, sessionMemberIds, UNGROUPED_KEY, visibleSessionIds,
} from '../tree.ts'
import { ProjectRowItem, SearchResultItem, SessionNodeItem } from './Rows.tsx'
import { FLAT_SESSION_ORDER_KEY, type SessionGroupBy } from '../stores.ts'
import { sectionsActive } from '../sections.ts'
import { ActivityList } from './ActivityList.tsx'
import { SectionsList } from './SectionsList.tsx'
import { useSectionDialogs } from './SectionDialogs.tsx'
import { WorkspacePickFlow } from '../WorkspacePicker.tsx'
import { sessionDragOrder, type SessionDragState, useNativeDragAcceptance } from './drag.ts'
import css from './WorkspaceBrowser.module.css'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500
/** Non-blank Session rows visible per Workspace while no Session raises its watermark. */
const SESSION_WATERMARK_BASE = 5
/** Highest watermark that attention-bearing Sessions raise automatically; Show more and search reveals may exceed it. */
const SESSION_WATERMARK_AUTO_MAX = 50

/** Show the blank row plus the first `watermark` non-blank rows, in list order. */
function watermarkRows(sessions: readonly SessionNode[], watermark: number): {
  rows: readonly SessionNode[]
  hiddenCount: number
} {
  let count = 0
  const rows = sessions.filter((session) => {
    if (session.blank) return true
    count += 1
    return count <= watermark
  })
  return { rows, hiddenCount: sessions.length - rows.length }
}

/**
 * Smallest watermark that covers every non-blank row within the automatic maximum that is running, has a running
 * child, awaits the user, carries an unread completion, or is current, and the reveal target at any position.
 */
function requiredWatermark(
  sessions: readonly SessionNode[],
  current: SessionId | undefined,
  revealSessionId: SessionId | undefined,
): number {
  let index = 0
  let required = 0
  for (const session of sessions) {
    if (session.blank) continue
    index += 1
    const attention = index <= SESSION_WATERMARK_AUTO_MAX && (
      session.running || session.runningSubagentCount > 0 || session.pendingInteraction !== undefined
      || session.completed || session.id === current
    )
    if (attention || session.id === revealSessionId) required = index
  }
  return required
}

/** Raise each listed group's watermark to its requirement; returns `marks` itself when nothing rises. */
function raiseWatermarks(
  marks: Readonly<Record<string, number>>,
  required: ReadonlyMap<string, number>,
): Readonly<Record<string, number>> {
  let raised = marks
  for (const [key, watermark] of required) {
    if (watermark > (raised[key] ?? SESSION_WATERMARK_BASE)) raised = { ...raised, [key]: watermark }
  }
  return raised
}

/** Keep controlled input and RPC payload inside the session.search wire contract. */
function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

/**
 * Render the view-options menu with local open state, so it resets with the wide chrome.
 * @param props - current grouping/order/filter selections, selection callbacks, and locale seat.
 * @returns the view-options menu anchored to the header control.
 */
function ViewOptionsMenu({ groupBy, orderBy, archivedFilter, onGroupPick, onOrderPick, onArchivedFilterPick, t }: {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  archivedFilter: ArchivedFilter
  onGroupPick: (mode: SessionGroupBy) => void
  onOrderPick: (mode: SessionOrderBy) => void
  onArchivedFilterPick: (filter: ArchivedFilter) => void
  t: WorkspaceBrowserProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'group-by', text: t('groupBy.label') },
        { id: 'workspace', label: t('groupBy.workspace'), icon: <IconFolderCloseRegular /> },
        { id: 'workspace-tree', label: t('groupBy.workspaceTree'), icon: <IconWorkspaceTreeOutlineRegular /> },
        { id: 'flat', label: t('groupBy.flat'), icon: <IconFlatListOutlineRegular /> },
        { id: 'activity', label: t('groupBy.activity'), icon: <IconGaugeOutlineRegular /> },
        { type: 'separator' as const, id: 'order-by-separator' },
        { type: 'label' as const, id: 'order-by', text: t('orderBy.label') },
        { id: 'manual', label: t('orderBy.manual'), icon: <IconChevronsUpDownOutlineRegular /> },
        { id: 'updated', label: t('orderBy.updated'), icon: <IconClockOutlineRegular /> },
        { type: 'separator' as const, id: 'archived-filter-separator' },
        { type: 'label' as const, id: 'filter-by', text: t('filterBy.label') },
        { id: 'hide-archived', label: t('viewOptions.hideArchived'), icon: <IconArchiveOffOutlineRegular /> },
        { id: 'show-archived', label: t('viewOptions.showArchived'), icon: <IconQueueOutlineRegular /> },
        { id: 'only-archived', label: t('viewOptions.onlyArchived'), icon: <IconArchiveCheckOutlineRegular /> },
      ]}
      selectedIds={[
        groupBy,
        orderBy,
        { default: 'hide-archived', show: 'show-archived', only: 'only-archived' }[archivedFilter],
      ]}
      onSelect={(id) => {
        if (id === 'workspace' || id === 'workspace-tree' || id === 'flat' || id === 'activity') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        else if (id === 'hide-archived') onArchivedFilterPick('default')
        else if (id === 'show-archived') onArchivedFilterPick('show')
        else if (id === 'only-archived') onArchivedFilterPick('only')
        setOpen(false)
      }}
      align="end"
      dense
      listClassName={css.viewOptionsMenu}
      // Portal: the section header clips overflow, so an in-place list would
      // be cut off at the header's bounds.
      portal
      anchor={(
        <Tooltip label={t('viewOptions.label')} side="bottom" delayMs={500} portal>
          <button
            type="button"
            className={clsx(css.iconButton, css.wide)}
            aria-label={t('viewOptions.label')}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconSlidersTwoOutlineRegular />
          </button>
        </Tooltip>
      )}
    />
  )
}

function WorkspaceFilterMenu({
  color, icon, onColor, onIcon, t,
}: {
  color: WorkspaceColor | undefined
  icon: WorkspaceIcon | undefined
  onColor: (value: WorkspaceColor | undefined) => void
  onIcon: (value: WorkspaceIcon | undefined) => void
  t: WorkspaceBrowserProps['t']
}) {
  const [open, setOpen] = useState(false)
  const items = [
    { type: 'label' as const, id: 'filter-colors', text: t('filter.color') },
    { id: 'color-all', label: t('filter.all') },
    ...WORKSPACE_COLORS.map(value => ({ id: `color-${value}`, label: t(`appearance.color.${value}`) })),
    { type: 'separator' as const, id: 'filter-icons-separator' },
    { type: 'label' as const, id: 'filter-icons', text: t('filter.icon') },
    { id: 'icon-all', label: t('filter.all') },
    ...WORKSPACE_ICONS.map(value => ({ id: `icon-${value}`, label: t(`appearance.icon.${value}`) })),
  ]
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={items}
      selectedIds={[...(color === undefined ? [] : [`color-${color}`]), ...(icon === undefined ? [] : [`icon-${icon}`])]}
      onSelect={(id) => {
        if (id === 'color-all') onColor(undefined)
        else if (id.startsWith('color-')) onColor(id.slice(6) as WorkspaceColor)
        else if (id === 'icon-all') onIcon(undefined)
        else if (id.startsWith('icon-')) onIcon(id.slice(5) as WorkspaceIcon)
        setOpen(false)
      }}
      align="end"
      dense
      portal
      anchor={(
        <Tooltip label={t('filter.label')} side="bottom" delayMs={500} portal>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('filter.label')}
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            <span aria-hidden="true">#</span>
          </button>
        </Tooltip>
      )}
    />
  )
}

/** In-flight Workspace-row drag: source identity plus the current marker. */
interface WorkspaceDragState {
  workspaceId: WorkspaceId
  over: { id: WorkspaceId; half: 'before' | 'after' } | null
}

/** Resolve an insertion side across the Workspace header, descendants, and Sessions. */
function workspaceGroupHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

type SessionTreeProps = Pick<
  WorkspaceBrowserProps,
  'useSessionStatus' | 'startSession' | 'open' | 'openSessionMenu' | 'openWorkspaceMenu' | 'useContextMenuTarget' | 'useContextMenu'
  | 'insertWorkspaceBefore' | 't' | 'usePanelInfo'
  | 'useRemoteAccess' | 'useSessionAccess' | 'useWorkspaceAccess'
> & PropsRenderSlots<
  | 'sidebar.workspaces.session.row.action'
  | 'sidebar.session.row.trailing'
  | 'sidebar.session.row.leading'
  | 'sidebar.session.row.hover'
> & {
  shortcuts: readonly import('@deepseek-ai/dsh-client-shortcuts/client').ShortcutCatalogEntry[]
  /** Always-mounted Session list snapshot. */
  list: SessionListState
  /** Host account home for POSIX hover-path abbreviation. */
  home?: string | undefined
  /** Workspaces in Host group order with browser-projected Session order. */
  workspaces: readonly WorkspaceView[]
  /** Chosen color and icon per Workspace. */
  appearanceByWorkspace: Readonly<Record<string, WorkspaceAppearance>>
  /** Chosen color and icon per Session. */
  appearanceBySession: Readonly<Record<string, WorkspaceAppearance>>
  /** Browser-projected order for Sessions outside every Workspace. */
  ungroupedSessionIds: readonly SessionId[]
  /** Whether the current Workspace stream has a complete Host baseline. */
  workspaceReady: boolean
  /** Grouping, ordering, and filter changes replace the view without row motion. */
  animationResetKey: string
  /** Nest Workspaces under their nearest registered ancestors. */
  nestWorkspaces: boolean
  /** Explicit persisted group expansion, including descendants in tree mode. */
  groupExpansion: Readonly<Record<string, boolean>>
  /** Persist one Workspace group's expansion. */
  setGroupExpanded: (key: string, expanded: boolean) => void
  /** Save a drag order and select Manual. */
  setSessionOrder: (accountKey: string, order: readonly string[]) => void
  /** Registry-global pin and archive sets plus the archived-visibility choice. */
  rowState: SessionRowState
  /** Switch the archived filter back to the default hide-archived view. */
  onLeaveArchivedOnly: () => void
  /** Open the rename dialog from a row title double-click. */
  onSessionRenameRequest: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** One Session chosen from search that must be exposed and scrolled into view. */
  revealSessionId?: SessionId | undefined
  /** Acknowledge that the chosen Session row has been revealed. */
  onSessionRevealed: (sessionId: SessionId) => void
  /**
   * Whether the Sections pane is present below this tree, which turns the
   * workspace rows into drop targets for filing a Chat into a section. Absent
   * or false leaves every row exactly as it was.
   */
  sectionDropTargets?: boolean | undefined
  /** Publish a Session drag so the Sections pane can accept it as a filing drop. */
  onChatDragStart: (sessionId: SessionId) => void
  /** End a published Session drag. */
  onChatDragEnd: () => void
}

/** The list-empty placeholder — a glyph over the text; the archived-only view names its filter and offers the way back. */
function EmptySessions({ rowState, onLeaveArchivedOnly, t }: Pick<SessionTreeProps, 'rowState' | 'onLeaveArchivedOnly' | 't'>) {
  const archivedOnly = rowState.archivedFilter === 'only'
  return (
    <div className={css.emptyState} data-row-key="empty">
      {archivedOnly ? <IconArchiveOutlineRegular size={24} /> : <IconQueueOutlineRegular size={24} />}
      <div>{archivedOnly ? t('empty.noneArchived') : t('empty.none')}</div>
      {archivedOnly && (
        <button type="button" className={css.emptyAction} onClick={onLeaveArchivedOnly}>
          {t('empty.viewOthers')}
        </button>
      )}
    </div>
  )
}

/** The scrolling session tree; unmounting drops the sessions subscription and the session watermarks. */
function SessionTree({
  list, useSessionStatus, startSession, open, workspaces, ungroupedSessionIds,
  appearanceByWorkspace, appearanceBySession,
  rowState, onLeaveArchivedOnly,
  workspaceReady, animationResetKey, usePanelInfo, useRemoteAccess, useSessionAccess, useWorkspaceAccess,
  onSessionRenameRequest,
  renderSlot, openSessionMenu, openWorkspaceMenu, useContextMenuTarget, useContextMenu,
  insertWorkspaceBefore,
  nestWorkspaces, groupExpansion, setGroupExpanded,
  setSessionOrder, home, t,
  revealSessionId, onSessionRevealed, shortcuts, sectionDropTargets = false, onChatDragStart, onChatDragEnd,
}: SessionTreeProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const statuses = useSessionStatus(s => s)
  const current = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const revealGroup = revealSessionId === undefined || !workspaceReady
    ? undefined
    : owningGroupKey(workspaces, revealSessionId)
  // Per-group raised watermarks; an absent key means the base watermark.
  const [storedWatermarks, setStoredWatermarks] = useState<Readonly<Record<string, number>>>({})
  // Advances on user-driven watermark changes so AnimatedRows settles them; automatic raises animate.
  const [watermarkMotionKey, setWatermarkMotionKey] = useState(0)
  // Transient drag marker state; the selected mode owns the resulting order.
  const [drag, setDrag] = useState<SessionDragState | null>(null)
  const sessionDropCommitted = useRef(false)
  const [workspaceDrag, setWorkspaceDrag] = useState<WorkspaceDragState | null>(null)
  const workspaceDropCommitted = useRef(false)
  const nativeDragActive = drag !== null || workspaceDrag !== null
  useNativeDragAcceptance(nativeDragActive)
  const currentGroup = current === undefined || !workspaceReady
    ? undefined
    : owningGroupKey(workspaces, current)
  useEffect(() => {
    if (current === undefined || currentGroup === undefined || Object.hasOwn(groupExpansion, currentGroup)) return
    setGroupExpanded(currentGroup, true)
  }, [current, currentGroup, setGroupExpanded, groupExpansion])
  const parents = useMemo(() => {
    if (!nestWorkspaces) return new Map<string, WorkspaceId | undefined>()
    const keysByPath = new Map(workspaces.map(workspace => [workspace.path, workspace.workspaceId]))
    const paths = [...keysByPath.keys()]
    return new Map<string, WorkspaceId | undefined>(workspaces.map((workspace) => {
      const path = owningParentFolder(workspace.path, paths)
      return [workspace.workspaceId, path === undefined ? undefined : keysByPath.get(path)]
    }))
  }, [nestWorkspaces, workspaces])
  const currentAncestors = useMemo(() => {
    const keys = new Set<string>()
    for (let key = currentGroup === undefined ? undefined : parents.get(currentGroup); key !== undefined; key = parents.get(key)) {
      keys.add(key)
    }
    return keys
  }, [currentGroup, parents])
  const expandedGroups = useMemo(() => {
    const ancestorKeys = new Set<string | undefined>(parents.values())
    return [...workspaces.map(workspace => workspace.workspaceId), UNGROUPED_KEY]
      .filter(key => groupExpansion[key] ?? ancestorKeys.has(key))
  }, [groupExpansion, parents, workspaces])
  const groups = useMemo(
    () => deriveGroups(list, workspaces, rowState, statuses, {
      expandedGroups,
      ungroupedOrder: ungroupedSessionIds,
    }),
    [list, workspaces, rowState, statuses, expandedGroups, ungroupedSessionIds],
  )
  useEffect(() => {
    for (let key = revealGroup; key !== undefined; key = parents.get(key)) {
      if (groupExpansion[key] === false || (key === revealGroup && groupExpansion[key] !== true)) {
        setGroupExpanded(key, true)
      }
    }
  }, [groupExpansion, parents, revealGroup, setGroupExpanded])
  const baselines = new Map(groups.map(group => [group.key, Math.max(SESSION_WATERMARK_BASE, requiredWatermark(
    group.sessions,
    current,
    group.key === revealGroup ? revealSessionId : undefined,
  ))]))
  const foldedKeys = new Set(groups.filter(group => !group.expanded).map(group => group.key))
  const underFoldedAncestor = (key: string): boolean => {
    for (let owner = parents.get(key); owner !== undefined; owner = parents.get(owner)) {
      if (foldedKeys.has(owner)) return true
    }
    return false
  }
  // A group hidden by a folded ancestor keeps its own expansion and rows but must not raise its watermark.
  const requiredWatermarks = new Map([...baselines].filter(([key]) => !underFoldedAncestor(key)))
  const sessionWatermarks = raiseWatermarks(storedWatermarks, requiredWatermarks)
  // Raising during render keeps the watermark monotonic without committing a lower frame first.
  if (sessionWatermarks !== storedWatermarks) setStoredWatermarks(marks => raiseWatermarks(marks, requiredWatermarks))
  const dropWatermarks = (drop: (key: string) => boolean): void => {
    if (!Object.keys(storedWatermarks).some(drop)) return
    setStoredWatermarks(marks => Object.fromEntries(Object.entries(marks).filter(([key]) => !drop(key))))
    setWatermarkMotionKey(key => key + 1)
  }
  const withinGroup = (key: string, root: string): boolean => {
    for (let owner: string | undefined = key; owner !== undefined; owner = parents.get(owner)) {
      if (owner === root) return true
    }
    return false
  }
  const now = Date.now()
  const commitSessionDrag = (activeDrag: SessionDragState, over: NonNullable<SessionDragState['over']>): void => {
    if (sessionDropCommitted.current) return
    sessionDropCommitted.current = true
    setDrag(null)
    const group = groups.find(candidate => candidate.key === activeDrag.accountKey)
    if (group === undefined) return
    if (over.id === activeDrag.sessionId) return
    const accountSessionIds = activeDrag.accountKey === UNGROUPED_KEY
      ? ungroupedSessionIds
      : workspaces.find(workspace => workspace.workspaceId === activeDrag.accountKey)?.sessionIds
    if (accountSessionIds === undefined) return
    const renderedSessions = watermarkRows(group.sessions, sessionWatermarks[group.key] ?? SESSION_WATERMARK_BASE).rows
    const nextOrder = sessionDragOrder(accountSessionIds, renderedSessions, activeDrag, over)
    if (nextOrder !== undefined) setSessionOrder(activeDrag.accountKey, nextOrder)
  }
  const commitWorkspaceDrag = (
    activeDrag: WorkspaceDragState,
    over: NonNullable<WorkspaceDragState['over']>,
  ): void => {
    if (workspaceDropCommitted.current) return
    workspaceDropCommitted.current = true
    setWorkspaceDrag(null)
    const owner = parents.get(activeDrag.workspaceId)
    const siblings = workspaces.filter(workspace => parents.get(workspace.workspaceId) === owner)
    const rowIndex = siblings.findIndex(workspace => workspace.workspaceId === over.id)
    if (rowIndex === -1) return
    const anchor = over.half === 'before' ? over.id : siblings[rowIndex + 1]?.workspaceId
    if (anchor === activeDrag.workspaceId) return
    const sourceIndex = siblings.findIndex(workspace => workspace.workspaceId === activeDrag.workspaceId)
    const anchorIndex = anchor === undefined
      ? siblings.length
      : siblings.findIndex(workspace => workspace.workspaceId === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason: unknown) => {
      console.warn('workspace reorder rejected:', reason)
    })
  }
  const childrenByParent = useMemo(() => {
    const rendered = new Set(groups.map(group => group.key))
    const children = new Map<string | undefined, GroupNode[]>()
    for (const group of groups) {
      // The archived-only view drops empty groups, so an ancestor may be
      // absent; nest under the nearest rendered one.
      let parent = parents.get(group.key)
      while (parent !== undefined && !rendered.has(parent)) parent = parents.get(parent)
      const siblings = children.get(parent)
      if (siblings === undefined) children.set(parent, [group])
      else siblings.push(group)
    }
    return children
  }, [groups, parents])
  // A collapsed row stands for its whole folded subtree: its own Sessions plus descendant Workspaces.
  const subtreeAttention = (group: GroupNode): GroupAttention | undefined =>
    (childrenByParent.get(group.key) ?? []).reduce<GroupAttention | undefined>(
      (sum, child) => mergeAttention(sum, subtreeAttention(child)),
      group.attention,
    )
  const rootGroups = childrenByParent.get(undefined) ?? []
  const workspaceDropAtListStart = rootGroups[0]?.workspaceId !== undefined
    && workspaceDrag?.over?.id === rootGroups[0].workspaceId
    && workspaceDrag.over.half === 'before'

  const rowKeys: string[] = groups.length === 0 ? ['empty'] : []
  const renderGroup = (group: GroupNode, depth: number): ReactNode => {
    const workspaceId = group.workspaceId
    const children = childrenByParent.get(group.key) ?? []
    const compatibleDrag = workspaceDrag !== null && parents.get(workspaceDrag.workspaceId) === parents.get(group.key)
    const watermark = sessionWatermarks[group.key] ?? SESSION_WATERMARK_BASE
    const collapsed = watermarkRows(group.sessions, baselines.get(group.key) ?? SESSION_WATERMARK_BASE)
    const visible = watermarkRows(group.sessions, watermark)
    const sessionsExpanded = visible.hiddenCount === 0
    rowKeys.push(`workspace:${group.key}`)
    const childRows = group.expanded ? children.map(child => renderGroup(child, depth + 1)) : []
    const sessions = visible.rows
    for (const node of sessions) rowKeys.push(`session:${node.id}`)
    if (collapsed.hiddenCount > 0) rowKeys.push(`overflow:${group.key}`)
    const workspaceMarker = workspaceId !== undefined && workspaceDrag?.over?.id === workspaceId
      ? workspaceDrag.over.half
      : null
    const workspaceDragProps = workspaceId === undefined ? undefined : {
      start: () => {
        workspaceDropCommitted.current = false
        setWorkspaceDrag({ workspaceId, over: null })
      },
      end: () => {
        if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) {
          commitWorkspaceDrag(workspaceDrag, workspaceDrag.over)
        } else {
          setWorkspaceDrag(null)
        }
        workspaceDropCommitted.current = false
      },
    }
    const hoverWorkspace = workspaceId === undefined || !compatibleDrag
      ? undefined
      : (half: 'before' | 'after') => {
        setWorkspaceDrag(active => active === null
          ? active
          : { ...active, over: { id: workspaceId, half } })
      }
    const dropWorkspace = workspaceId === undefined || !compatibleDrag
      ? undefined
      : (half: 'before' | 'after') => {
        commitWorkspaceDrag(workspaceDrag, { id: workspaceId, half })
      }
    return (
    // Group section: header, descendant Workspaces, and own Session rows. The
    // inter-group breathing room is the section's own margin
    // (WorkspaceBrowser.module.css).
      <div
        key={group.key}
        style={{ '--dsh-workspace-indent': `${depth * 12}px` } as CSSProperties}
        className={clsx(
          css.groupSection,
          workspaceMarker === 'before' && css.workspaceDropBefore,
          workspaceMarker === 'after' && css.workspaceDropAfter,
        )}
        onDragOver={workspaceDrag === null
          ? undefined
          : (e) => {
            e.preventDefault()
            if (hoverWorkspace === undefined && parents.get(group.key) !== undefined) return
            e.stopPropagation()
            if (hoverWorkspace === undefined) {
              e.dataTransfer.dropEffect = 'none'
              if (workspaceDrag.over !== null) setWorkspaceDrag({ ...workspaceDrag, over: null })
            } else {
              e.dataTransfer.dropEffect = 'move'
              hoverWorkspace(workspaceGroupHalf(e))
            }
          }}
        onDrop={workspaceDrag === null
          ? undefined
          : (e) => {
            e.preventDefault()
            if (dropWorkspace === undefined && parents.get(group.key) !== undefined) return
            e.stopPropagation()
            if (dropWorkspace === undefined) {
              workspaceDropCommitted.current = true
              setWorkspaceDrag(null)
            } else {
              dropWorkspace(workspaceGroupHalf(e))
            }
          }}
      >
        <ProjectRowItem
          newShortcut={shortcuts.find(row => row.id === 'session.new')}
          group={group}
          appearance={group.workspaceId === undefined ? undefined : appearanceByWorkspace[group.workspaceId]}
          attention={group.expanded ? undefined : subtreeAttention(group)}
          openWorkspaceMenu={openWorkspaceMenu} useContextMenu={useContextMenu} useContextMenuTarget={useContextMenuTarget}
          useRemoteAccess={useRemoteAccess}
          useWorkspaceAccess={useWorkspaceAccess}
          containsCurrentDescendant={currentAncestors.has(group.key)}
          home={home}
          t={t}
          onToggle={() => {
            if (group.expanded) dropWatermarks(key => withinGroup(key, group.key))
            setGroupExpanded(group.key, !group.expanded)
          }}
          onCreate={() => {
            if (group.workspaceId !== undefined) {
              setGroupExpanded(group.key, true)
              startSession(group.workspaceId)
            }
          }}
          drag={workspaceDragProps}
        />
        {childRows.length > 0 && (
          <div role="group">
            {childRows}
          </div>
        )}
        {sessions.map((node) => {
        // Session drag never leaves its browser-local account, and pinned
        // rows reorder only within their leading pinned block.
          const sameGroupDrag = drag !== null && drag.accountKey === group.key
          const compatibleTarget = sameGroupDrag && drag.pinned === node.pinned
          const normalizeHalf = (half: 'before' | 'after'): 'before' | 'after' =>
            node.blank ? 'after' : half
          const dragProps = {
            start: () => {
              sessionDropCommitted.current = false
              setDrag({ accountKey: group.key, sessionId: node.id, pinned: node.pinned, over: null })
              if (sectionDropTargets) onChatDragStart(node.id)
            },
            active: compatibleTarget,
            marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
            hover: (half: 'before' | 'after') => {
            /* v8 ignore next -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
              setDrag(d => (d === null ? d : {
                ...d, over: { id: node.id, half: normalizeHalf(half) },
              }))
            },
            drop: (half: 'before' | 'after') => {
            /* v8 ignore next -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
              if (drag === null) return
              commitSessionDrag(drag, { id: node.id, half: normalizeHalf(half) })
            },
            end: () => {
              if (drag?.over !== null && drag?.over !== undefined) commitSessionDrag(drag, drag.over)
              else setDrag(null)
              sessionDropCommitted.current = false
              if (sectionDropTargets) onChatDragEnd()
            },
          }
          return (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={current}
              now={now}
              onOpen={open}
              onRenameRequest={onSessionRenameRequest}
              renderSlot={renderSlot}
              openSessionMenu={openSessionMenu} useContextMenu={useContextMenu}
              useContextMenuTarget={useContextMenuTarget}
              appearance={group.workspaceId === undefined
                ? appearanceBySession[node.id]
                : { ...appearanceByWorkspace[group.workspaceId], ...appearanceBySession[node.id] }}
              onReveal={node.id === revealSessionId && group.key === revealGroup
                ? () => { onSessionRevealed(node.id) }
                : undefined}
              drag={dragProps}
              home={home}
              useSessionAccess={useSessionAccess}
              t={t}
            />
          )
        })}
        {collapsed.hiddenCount > 0 && (
          <button
            type="button"
            className={css.sessionOverflowButton}
            data-row-key={`overflow:${group.key}`}
            aria-expanded={sessionsExpanded}
            onClick={() => {
              if (sessionsExpanded) {
                dropWatermarks(key => key === group.key)
                return
              }
              setStoredWatermarks(marks => ({
                ...marks,
                [group.key]: visible.hiddenCount <= SESSION_WATERMARK_BASE ? Infinity : watermark + SESSION_WATERMARK_BASE,
              }))
              setWatermarkMotionKey(key => key + 1)
            }}
          >
            {sessionsExpanded
              ? t('sessions.collapse')
              : t('sessions.expand', { n: visible.hiddenCount })}
          </button>
        )}
      </div>
    )
  }

  const groupRows = rootGroups.map(group => renderGroup(group, 0))
  return (
    <HoverCardGroup className={clsx(css.treeBody, css.wide)}>
      {workspaceDropAtListStart && <span className={css.listTopDropIndicator} aria-hidden="true" />}
      <AnimatedRows
        className={clsx(css.list, workspaceDropAtListStart && css.listTopDropActive)}
        role="tree"
        label={t('section.sessions')}
        rowKeys={rowKeys}
        ready={list.phase === 'ready' && workspaceReady && !nativeDragActive}
        resetKey={JSON.stringify([animationResetKey, watermarkMotionKey])}
      >
        {groups.length === 0 && (
          <EmptySessions rowState={rowState} onLeaveArchivedOnly={onLeaveArchivedOnly} t={t} />
        )}
        {groupRows}
      </AnimatedRows>
      <span className={css.fade} />
    </HoverCardGroup>
  )
}

/** The flat "In one list" body: every session is one draggable top-level row. */
function FlatList({
  list, sessionIds, rowState, onLeaveArchivedOnly, useSessionStatus, useSessionAccess, open, onSessionRenameRequest,
  usePanelInfo, setSessionOrder, workspaceReady, animationResetKey, appearanceBySession,
  revealSessionId, onSessionRevealed, renderSlot, openSessionMenu, useContextMenuTarget, useContextMenu, home, t,
}: Pick<
  SessionTreeProps,
  | 'useSessionStatus'
  | 'useSessionAccess'
  | 'open'
  | 'onSessionRenameRequest'
  | 'renderSlot'
  | 'openSessionMenu' | 'useContextMenuTarget' | 'useContextMenu'
  | 'usePanelInfo'
  | 'setSessionOrder'
  | 'workspaceReady'
  | 'animationResetKey'
  | 'revealSessionId'
  | 'onSessionRevealed'
  | 'rowState'
  | 'onLeaveArchivedOnly'
  | 'home'
  | 't'
> & {
  list: SessionListState
  sessionIds: readonly SessionId[]
  appearanceBySession: Readonly<Record<string, WorkspaceAppearance>>
}) {
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
    <HoverCardGroup className={clsx(css.treeBody, css.wide)}>
      <AnimatedRows
        className={clsx(css.list, css.flatList)}
        role="tree"
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
              openSessionMenu={openSessionMenu} useContextMenu={useContextMenu}
              useContextMenuTarget={useContextMenuTarget}
              appearance={appearanceBySession[node.id]}
              onReveal={node.id === revealSessionId
                ? () => { onSessionRevealed(node.id) }
                : undefined}
              useSessionAccess={useSessionAccess}
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
              home={home}
              t={t}
            />
          )
        })}
      </AnimatedRows>
      <span className={css.fade} />
    </HoverCardGroup>
  )
}

interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

/** Flat search body: local metadata matches plus the current Host result page. */
function SearchResults({
  useSessions,
  useSessionStatus,
  open,
  onUnarchive,
  workspaces,
  archivedSessionIds,
  archivedFilter,
  query,
  remote,
  resultLimit,
  usePanelInfo,
  useSessionAccess,
  t,
}: Pick<WorkspaceBrowserProps, 'useSessions' | 'useSessionStatus' | 'open' | 't' | 'usePanelInfo' | 'useSessionAccess'> & {
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionNode['id'][]
  /** Search matches follow the archived filter selected for the list. */
  archivedFilter: ArchivedFilter
  /** Unarchive an archived result row in place. */
  onUnarchive: (id: SessionNode['id']) => void
  query: string
  remote: RemoteSearchState
  resultLimit: number
}) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const list = useSessions(s => s)
  const statuses = useSessionStatus(s => s)
  const currentRemote = remote.query === query
    ? remote
    : { query, status: 'loading' as const, items: [], hasMore: false }
  const results = useMemo(
    () => deriveSearchResults(
      list,
      workspaces,
      query,
      archivedSessionIds,
      archivedFilter,
      statuses,
      currentRemote,
      resultLimit,
    ),
    [list, workspaces, query, archivedSessionIds, archivedFilter, statuses, currentRemote, resultLimit],
  )
  const pending = currentRemote.status === 'loading'
  const currentId = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list}>
        <div className={css.searchTree} role="tree" aria-label={t('search.results.aria')}>
          {results.items.map(result => (
            <SearchResultItem
              key={result.id}
              result={result}
              currentId={currentId}
              onOpen={open}
              onUnarchive={onUnarchive}
              useSessionAccess={useSessionAccess}
              t={t}
            />
          ))}
        </div>
        {pending && (
          /* Two skeleton rows on an empty list, one when local matches already
             show and only the content hits are outstanding. */
          <div role="status" aria-label={t('search.pending')}>
            {(results.items.length === 0 ? [0, 1] : [0]).map(i => (
              <div key={i} className={css.skeletonRow} aria-hidden="true">
                <span className={css.skeletonDot} />
                <span className={css.skeletonBars}>
                  <span className={css.skeletonBar} />
                  <span className={clsx(css.skeletonBar, css.skeletonBarWide)} />
                </span>
              </div>
            ))}
          </div>
        )}
        {!pending && results.items.length === 0 && (
          <div className={css.empty}>{t('search.noMatches')}</div>
        )}
        {results.hasMore && (
          <div className={css.searchStatus}>
            {t('search.hasMore', { n: resultLimit })}
          </div>
        )}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
export function WorkspaceBrowser({
  wide,
  usePanelInfo,
  expandSidebar,
  useSessions,
  useSessionStatus,
  useRemoteAccess,
  useSessionAccess,
  useWorkspaceAccess,
  useWorkspaces,
  useStore,
  useAppearance,
  useWorkspaceActionRequest,
  useSectionActionRequest,
  actions,
  startSession,
  open,
  requestSessionRename,
  notifyArchivedNotOpenable,
  renameWorkspace,
  settleWorkspaceAction,
  deleteWorkspace,
  insertWorkspaceBefore,
  unarchiveSession,
  createWorkspace,
  newSectionId,
  searchSessions,
  searchResultLimit,
  useDirectoryFlow,
  useHostInfo,
  useShortcuts,
  useWorkspaceShortcuts,
  requestSearch,
  requestAddWorkspace,
  closeAddWorkspace,
  setDirectoryBusy,
  renderSlot, openSessionMenu, openWorkspaceMenu, openSectionMenu, settleSectionAction,
  useContextMenuTarget, useContextMenu,
  t,
}: WorkspaceBrowserProps) {
  const home = useHostInfo(info => info.home)
  const shortcuts = useShortcuts(rows => rows)
  const searchShortcut = shortcuts.find(row => row.id === 'session.search')
  const addShortcut = shortcuts.find(row => row.id === 'workspace.add')
  const shortcutState = useWorkspaceShortcuts(state => state)
  // Ordering remains live while the rail or search replaces the list body.
  const list = useSessions(state => state)
  const storedWorkspaces = useWorkspaces(state => state.items)
  // The resolved name, not `t`, is the memo dependency: the bound seat keeps
  // its identity across a language switch.
  const defaultWorkspaceName = t('workspace.defaultName')
  const workspaces = useMemo(
    () => storedWorkspaces.map(workspace => ({
      ...workspace,
      title: workspaceDisplayTitle(workspace.title, defaultWorkspaceName),
    })),
    [storedWorkspaces, defaultWorkspaceName],
  )
  const workspacePhase = useWorkspaces(state => state.phase)
  const workspaceStreamState = useWorkspaces(state => state.state)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const pinnedSessionIds = useWorkspaces(state => state.pinnedSessionIds)
  // Live occupancy of this surface's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const groupBy = useStore(s => s.groupBy)
  const orderBy = useStore(s => s.orderBy)
  // Persisted view blobs written before the archived filter existed rehydrate
  // without the field; they read as the default hide-archived view.
  const archivedFilter = useStore(s => s.archivedFilter ?? 'default')
  const groupExpansion = useStore(s => s.groupExpansion)
  const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount)
  const chatSections = useStore(s => s.chatSections)
  const appearances = useAppearance(value => value)
  const [externalChatSessionId, setExternalChatSessionId] = useState<SessionId | null>(null)
  // Sections render in their own pane below the Workspace pane, so this only
  // decides whether that pane exists — never which Workspace projection shows.
  const sectionsOn = sectionsActive(chatSections)
  useNativeDragAcceptance(externalChatSessionId !== null)
  // Archived sessions are not openable: the row stays visible under the
  // filter but a click explains instead of navigating.
  const guardedOpen = (sessionId: SessionId): void => {
    if (archivedSessionIds.includes(sessionId)) {
      notifyArchivedNotOpenable()
      return
    }
    open(sessionId)
  }
  const leaveArchivedOnly = (): void => { actions.setArchivedFilter('default') }
  const workspaceReady = workspacePhase === 'ready' && workspaceStreamState !== 'loading'
  const mainSessionId = Object.values(list.byId)
    .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const currentBlank = mainSessionId !== undefined && list.byId[mainSessionId]?.blank === true
    ? mainSessionId
    : undefined
  const [filterColor, setFilterColor] = useState<WorkspaceColor | undefined>(undefined)
  const [filterIcon, setFilterIcon] = useState<WorkspaceIcon | undefined>(undefined)
  const ungroupedMemberIds = useMemo(() => {
    const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
    return list.ids.filter(id => list.byId[id] !== undefined && !accounted.has(id))
  }, [list, workspaces])
  const orderState = useMemo(
    () => ({ pinnedSessionIds, archivedSessionIds }),
    [archivedSessionIds, pinnedSessionIds],
  )
  const rowState = useMemo<SessionRowState>(
    () => ({ ...orderState, archivedFilter }),
    [orderState, archivedFilter],
  )
  const flatMemberIds = useMemo(() => sessionMemberIds(list), [list])
  // The Sections pane files visible Sessions only, so it follows the archived filter.
  const sectionMemberIds = useMemo(
    () => visibleSessionIds(list, archivedSessionIds, archivedFilter),
    [archivedFilter, archivedSessionIds, list],
  )
  const orderedWorkspaces = useMemo(() => workspaces.map((workspace) => {
    const memberIds = workspace.sessionIds
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(memberIds, list.byId)
      : reconcileManualOrder(memberIds, sessionOrderByAccount[workspace.workspaceId], list.byId, orderState)
    return {
      ...workspace,
      sessionIds: pinCurrentBlank(
        baseOrder,
        currentBlank !== undefined && memberIds.includes(currentBlank) ? currentBlank : undefined,
      ),
    }
  }), [currentBlank, list.byId, orderBy, orderState, sessionOrderByAccount, workspaces])
  const visibleWorkspaces = useMemo(() => orderedWorkspaces.filter((workspace) => {
    const appearance = appearances.workspaces[workspace.workspaceId]
    return (filterColor === undefined || appearance?.color === filterColor)
      && (filterIcon === undefined || appearance?.icon === filterIcon)
  }), [appearances.workspaces, filterColor, filterIcon, orderedWorkspaces])
  const orderedUngroupedSessionIds = useMemo(() => {
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(ungroupedMemberIds, list.byId)
      : reconcileManualOrder(ungroupedMemberIds, sessionOrderByAccount[UNGROUPED_KEY], list.byId, orderState)
    return pinCurrentBlank(
      baseOrder,
      currentBlank !== undefined && ungroupedMemberIds.includes(currentBlank) ? currentBlank : undefined,
    )
  }, [currentBlank, list.byId, orderBy, orderState, sessionOrderByAccount, ungroupedMemberIds])
  const orderedFlatSessionIds = useMemo(() => {
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(flatMemberIds, list.byId)
      : reconcileManualOrder(flatMemberIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY], list.byId, orderState)
    return pinCurrentBlank(
      baseOrder,
      currentBlank !== undefined && flatMemberIds.includes(currentBlank) ? currentBlank : undefined,
    )
  }, [currentBlank, flatMemberIds, list.byId, orderBy, orderState, sessionOrderByAccount])
  const activeSessionOrders = useMemo<Readonly<Record<string, readonly SessionId[]>>>(() => Object.fromEntries([
    ...orderedWorkspaces.map(workspace => [workspace.workspaceId, workspace.sessionIds] as const),
    [UNGROUPED_KEY, orderedUngroupedSessionIds] as const,
    [FLAT_SESSION_ORDER_KEY, orderedFlatSessionIds] as const,
  ]), [orderedFlatSessionIds, orderedUngroupedSessionIds, orderedWorkspaces])
  useEffect(() => {
    if (workspacePhase !== 'ready') return
    actions.retainAccountKeys([
      UNGROUPED_KEY,
      FLAT_SESSION_ORDER_KEY,
      ...workspaces.map(workspace => workspace.workspaceId),
    ])
  }, [actions.retainAccountKeys, workspacePhase, workspaces])
  useEffect(() => {
    if (list.phase !== 'ready' || workspaceReady || orderBy !== 'manual' || currentBlank === undefined) return
    // A first prompt can end blank pinning before the Workspace baseline arrives.
    // Preserve saved members until that baseline can establish departures.
    const changed: Record<string, readonly string[]> = {}
    for (const [key, ids] of Object.entries(activeSessionOrders)) {
      if (key !== FLAT_SESSION_ORDER_KEY && workspacePhase !== 'ready') continue
      const saved = sessionOrderByAccount[key] ?? []
      if (ids[0] !== currentBlank || saved[0] === currentBlank) continue
      changed[key] = [currentBlank, ...saved.filter(id => id !== currentBlank)]
    }
    if (Object.keys(changed).length > 0) actions.syncSessionOrders(changed)
  }, [
    actions.syncSessionOrders,
    activeSessionOrders,
    currentBlank,
    list.phase,
    orderBy,
    sessionOrderByAccount,
    workspacePhase,
    workspaceReady,
  ])
  useEffect(() => {
    if (list.phase !== 'ready' || !workspaceReady || orderBy !== 'manual' || currentBlank === undefined) return
    const moved = Object.entries(activeSessionOrders).some(([key, ids]) =>
      ids[0] === currentBlank && sessionOrderByAccount[key]?.[0] !== currentBlank)
    if (moved) actions.syncSessionOrders(activeSessionOrders)
  }, [
    actions.syncSessionOrders,
    activeSessionOrders,
    currentBlank,
    list.phase,
    orderBy,
    sessionOrderByAccount,
    workspaceReady,
  ])
  const saveSessionOrder = (accountKey: string, order: readonly string[]): void => {
    actions.setSessionOrder(accountKey, order, activeSessionOrders)
  }
  // The query outlives the tree and the input (both wide-only) so collapsing
  // does not silently drop an in-progress filter.
  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [searchSpacingMotionEnabled, setSearchSpacingMotionEnabled] = useState(false)
  const [searchOnExpand, setSearchOnExpand] = useState(false)
  const [lastSearchRequest, setLastSearchRequest] = useState(0)
  // Search state must commit before the effect expands the shell's external store.
  if (lastSearchRequest !== shortcutState.searchRequest) {
    setLastSearchRequest(shortcutState.searchRequest)
    if (shortcutState.searchRequest !== 0) {
      setSearchExpanded(true)
      setSearchSpacingMotionEnabled(wide)
      if (!wide) setSearchOnExpand(true)
    }
  }
  // Search gestures animate spacing; entering wide layout from the rail lands at its final geometry.
  if (!wide && searchSpacingMotionEnabled) setSearchSpacingMotionEnabled(false)
  const changeSearchExpanded = (expanded: boolean): void => {
    setSearchSpacingMotionEnabled(wide)
    setSearchExpanded(expanded)
  }
  const [revealSessionId, setRevealSessionId] = useState<SessionId | undefined>(undefined)
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const [remoteSearch, setRemoteSearch] = useState<RemoteSearchState>({
    query: '',
    status: 'idle',
    items: [],
    hasMore: false,
  })
  const searchRoot = useRef<HTMLDivElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  // Section-header add button opens the directory flow (same popover in wide
  // and rail states; the flow anchors on this button).
  const wsPickerOpen = shortcutState.addRequested
  const wsPlusRef = useRef<HTMLButtonElement>(null)
  const workspaceActionRequest = useWorkspaceActionRequest(value => value)
  const sectionActionRequest = useSectionActionRequest(value => value)

  const openSearchResult = (sessionId: SessionId): void => {
    if (archivedSessionIds.includes(sessionId)) {
      notifyArchivedNotOpenable()
      return
    }
    setRevealSessionId(sessionId)
    setQuery('')
    changeSearchExpanded(false)
    open(sessionId)
  }
  const acknowledgeSessionReveal = (sessionId: SessionId): void => {
    setRevealSessionId(current => current === sessionId ? undefined : current)
  }
  useEffect(() => {
    if (normalizedQuery !== '') setRevealSessionId(undefined)
  }, [normalizedQuery])

  // Rail search = expand + land in the search box: the flag arms before the
  // expand request; once the shell flips wide the input mounts and takes focus.
  useEffect(() => {
    if (wide && searchOnExpand) {
      const timer = window.setTimeout(() => {
        searchInput.current?.focus({ preventScroll: true })
        setSearchOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => { window.clearTimeout(timer) }
    }
  }, [wide, searchOnExpand])
  useEffect(() => {
    if (shortcutState.searchRequest === 0) return
    closeAddWorkspace()
    if (!wide || searchInput.current?.closest('[inert]')) {
      setSearchOnExpand(true)
      expandSidebar()
    } else searchInput.current?.focus({ preventScroll: true })
  }, [shortcutState.searchRequest])

  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    searchInput.current?.focus({ preventScroll: true })
  }, [wide, searchExpanded, searchOnExpand])
  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return
      searchInput.current?.blur()
      if (normalizedQuery !== '') return
      changeSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedQuery, wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemoteSearch({
      query: normalizedQuery,
      status: 'loading',
      items: [],
      hasMore: false,
    })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'ready',
          items: result.items,
          hasMore: result.hasMore,
        })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'error',
          items: [],
          hasMore: false,
        })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  // The search results' restore button; the row actions own the rest of the
  // Session verbs as slot entries.
  const onSessionUnarchive = (sessionId: SessionNode['id']) => {
    unarchiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session unarchive rejected:', reason)
    })
  }
  const {
    dialogs: sectionDialogs,
    onCreateRequest: onSectionCreate,
    onRenameRequest: onSectionRename,
    onDeleteRequest: onSectionDelete,
  } = useSectionDialogs({
    sections: chatSections.sections,
    createSection: actions.createSection,
    renameSection: actions.renameSection,
    deleteSection: actions.deleteSection,
    newSectionId,
    expandSection: (sectionId) => { actions.setSectionCollapsed(sectionId, false) },
    t,
  })
  useEffect(() => {
    if (sectionActionRequest === null) return
    if (sectionActionRequest.action === 'rename') onSectionRename(sectionActionRequest.sectionId, sectionActionRequest.displayTitle)
    else onSectionDelete(sectionActionRequest.sectionId, sectionActionRequest.displayTitle)
    settleSectionAction()
  }, [sectionActionRequest])
  // Section membership survives a Session leaving the visible list only while
  // the Chat still exists; a departed Session's assignment and saved slot are
  // dropped so the persisted layer cannot grow without bound.
  const sessionAccountKeys = list.ids
  useEffect(() => {
    if (list.phase !== 'ready') return
    actions.retainSectionSessions(sessionAccountKeys)
  }, [actions.retainSectionSessions, list.phase, sessionAccountKeys])

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      <div className={clsx(css.sectionHeader, wide && searchSpacingMotionEnabled && css.searchSpacingMotion)}>
        {wide && (
          <span className={clsx(css.sectionLabel, css.wide, searchExpanded && css.sectionLabelHidden)}>
            {groupBy === 'activity' ? t('groupBy.activity')
              : groupBy === 'flat' ? t('section.sessions')
                : t('section.workspaces')}
          </span>
        )}
        {/* The color/icon filter stays on screen in every mode: it narrows
            workspace groups, and the Workspace pane is always present. */}
        {wide && (
          <WorkspaceFilterMenu
            color={filterColor}
            icon={filterIcon}
            onColor={setFilterColor}
            onIcon={setFilterIcon}
            t={t}
          />
        )}
        {wide && (
          <div className={clsx(css.searchSlot, searchExpanded && css.searchSlotExpanded)}>
            <div
              ref={searchRoot}
              className={clsx(css.search, searchExpanded && css.searchExpanded)}
              onClick={() => {
                closeAddWorkspace()
                changeSearchExpanded(true)
                searchInput.current?.focus()
              }}
            >
              <Tooltip label={t('search')} shortcutKeys={searchShortcut?.keys} side="bottom" delayMs={500} disabled={searchExpanded} portal>
                <button
                  type="button"
                  className={css.searchButton}
                  aria-label={t('search.sessions.aria')}
                  aria-keyshortcuts={searchShortcut?.aria}
                  aria-expanded={searchExpanded}
                  onClick={() => {
                    requestSearch()
                  }}
                >
                  <IconSearchOutlineRegular size={searchExpanded ? 11 : 14} />
                </button>
              </Tooltip>
              <input
                ref={searchInput}
                className={css.searchInput}
                type="text"
                placeholder={t('search.placeholder')}
                maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
                value={query}
                tabIndex={searchExpanded ? 0 : -1}
                onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  setQuery('')
                  changeSearchExpanded(false)
                }}
              />
              {searchExpanded && (
                <button
                  type="button"
                  className={css.clearButton}
                  aria-label={t('search.clear')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setQuery('')
                    changeSearchExpanded(false)
                  }}
                >
                  <IconCloseFillRegular />
                </button>
              )}
            </div>
          </div>
        )}
        <div className={clsx(css.headerActions, wide && searchExpanded && css.headerActionsHidden)}>
          {/* Established order: Add workspace, View options, then the section
              action last. Add workspace leads with its folder-plus glyph, and
              New section uses a plain plus so the two cannot be confused. */}
          {directoryFlowAvailable && (
            <Tooltip label={t('workspace.add')} shortcutKeys={addShortcut?.keys} side="bottom" delayMs={500} portal>
              <button
                ref={wsPlusRef}
                type="button"
                className={css.iconButton}
                aria-label={t('workspace.add')}
                aria-keyshortcuts={addShortcut?.aria}
                onClick={() => {
                  requestAddWorkspace()
                }}
              >
                <IconProjectAddOutlineRegular size={wide ? 16 : 18} />
              </button>
            </Tooltip>
          )}
          {wide && (
            <ViewOptionsMenu
              groupBy={groupBy}
              orderBy={orderBy}
              archivedFilter={archivedFilter}
              onGroupPick={actions.setGroupBy}
              onOrderPick={(mode) => { actions.setOrderBy(mode, activeSessionOrders) }}
              onArchivedFilterPick={actions.setArchivedFilter}
              t={t}
            />
          )}
          {wide && (
            <Tooltip label={t('section.new')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('section.new')}
                onClick={onSectionCreate}
              >
                <IconPlusOutlineRegular size={16} />
              </button>
            </Tooltip>
          )}
        </div>
        {/* Add flow + its error dialog (same package — direct composition). */}
        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          anchorRef={wsPlusRef}
          useWorkspaces={useWorkspaces}
          createWorkspace={createWorkspace}
          useDirectoryFlow={useDirectoryFlow}
          renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
          addOnly
          onBusyChange={setDirectoryBusy}
          side="right"
          onPick={(workspaceId) => {
            closeAddWorkspace()
            startSession(workspaceId, { clearPreviousDraft: false })
          }}
          onClose={() => { closeAddWorkspace() }}
        />
      </div>

      {/* The collapsed rail keeps search as its own 36px control. */}
      {!wide && <div className={css.search}>
        <Tooltip label={t('search')} shortcutKeys={searchShortcut?.keys} portal>
          <button
            type="button"
            className={css.searchButton}
            aria-label={t('search.sessions.aria')}
            aria-keyshortcuts={searchShortcut?.aria}
            onClick={() => {
              requestSearch()
            }}
          >
            <IconSearchOutlineRegular size={18} />
          </button>
        </Tooltip>
      </div>}

      {/* Always-mounted seat keeps the region's flex slot while the list
          itself is wide-only. When sections exist this seat stacks two
          independently scrolling panes: Workspaces above the divider, Chat
          Sections below it. */}
      <div className={clsx(css.listArea, wide && sectionsOn && css.listAreaStacked)}>
        {wide && sectionsOn && (
          <div className={css.paneHeading}>{t('section.workspaces')}</div>
        )}
        <div className={css.workspacePane}>
          {wide && (normalizedQuery !== ''
            ? (
              <SearchResults
                usePanelInfo={usePanelInfo}
                useSessionAccess={useSessionAccess}
                useSessions={useSessions}
                useSessionStatus={useSessionStatus}
                open={openSearchResult}
                onUnarchive={onSessionUnarchive}
                workspaces={workspaces}
                archivedSessionIds={archivedSessionIds}
                archivedFilter={archivedFilter}
                query={normalizedQuery}
                remote={remoteSearch}
                resultLimit={searchResultLimit}
                t={t}
              />
            )
            : groupBy === 'activity'
              ? (
                <ActivityList
                  list={list}
                  sessionIds={orderedFlatSessionIds}
                  rowState={rowState}
                  appearanceBySession={appearances.sessions}
                  useSessionStatus={useSessionStatus}
                  usePanelInfo={usePanelInfo}
                  open={guardedOpen}
                  openSessionMenu={openSessionMenu}
                  useContextMenu={useContextMenu}
                  useContextMenuTarget={useContextMenuTarget}
                  useSessionAccess={useSessionAccess}
                  onSessionRenameRequest={requestSessionRename}
                  renderSlot={renderSlot}
                  t={t}
                />
              )
              : groupBy === 'flat'
                ? (
                  <FlatList
                    useSessionAccess={useSessionAccess}
                    usePanelInfo={usePanelInfo}
                    list={list}
                    sessionIds={orderedFlatSessionIds}
                    rowState={rowState}
                    onLeaveArchivedOnly={leaveArchivedOnly}
                    workspaceReady={workspaceReady}
                    animationResetKey={`${groupBy}/${orderBy}/${archivedFilter}`}
                    appearanceBySession={appearances.sessions}
                    useSessionStatus={useSessionStatus}
                    open={guardedOpen}
                    onSessionRenameRequest={requestSessionRename}
                    openSessionMenu={openSessionMenu}
                    useContextMenu={useContextMenu}
                    useContextMenuTarget={useContextMenuTarget}
                    renderSlot={renderSlot}
                    setSessionOrder={saveSessionOrder}
                    revealSessionId={revealSessionId}
                    onSessionRevealed={acknowledgeSessionReveal}
                    home={home}
                    t={t}
                  />
                )
                : (
                  <SessionTree
                    useRemoteAccess={useRemoteAccess}
                    useSessionAccess={useSessionAccess}
                    useWorkspaceAccess={useWorkspaceAccess}
                    usePanelInfo={usePanelInfo}
                    list={list}
                    shortcuts={shortcuts}
                    useSessionStatus={useSessionStatus}
                    onSessionRenameRequest={requestSessionRename}
                    renderSlot={renderSlot}
                    openSessionMenu={openSessionMenu}
                    useContextMenu={useContextMenu}
                    openWorkspaceMenu={openWorkspaceMenu}
                    useContextMenuTarget={useContextMenuTarget}
                    workspaces={visibleWorkspaces}
                    appearanceByWorkspace={appearances.workspaces}
                    appearanceBySession={appearances.sessions}
                    ungroupedSessionIds={orderedUngroupedSessionIds}
                    workspaceReady={workspaceReady}
                    nestWorkspaces={groupBy === 'workspace-tree'}
                    animationResetKey={`${groupBy}/${orderBy}/${archivedFilter}`}
                    groupExpansion={groupExpansion}
                    setGroupExpanded={actions.setGroupExpanded}
                    setSessionOrder={saveSessionOrder}
                    rowState={rowState}
                    onLeaveArchivedOnly={leaveArchivedOnly}
                    startSession={startSession}
                    open={guardedOpen}
                    insertWorkspaceBefore={insertWorkspaceBefore}
                    revealSessionId={revealSessionId}
                    onSessionRevealed={acknowledgeSessionReveal}
                    home={home}
                    t={t}
                    sectionDropTargets={sectionsOn}
                    onChatDragStart={setExternalChatSessionId}
                    onChatDragEnd={() => { setExternalChatSessionId(null) }}
                  />
                ))}
        </div>

        {/* The Sections pane: a saved visual filter over the Workspace pane
            above. Chats stay in their workspace folders; filing one only adds
            it here, so nothing is ever lost from the list above. */}
        {wide && sectionsOn && (
          <SectionsList
            usePanelInfo={usePanelInfo}
            useSessionStatus={useSessionStatus}
            list={list}
            rowState={rowState}
            visibleSessionIds={sectionMemberIds}
            sections={chatSections}
            appearanceBySection={appearances.sections}
            appearanceBySession={appearances.sessions}
            currentBlank={currentBlank}
            open={guardedOpen}
            onSessionRenameRequest={requestSessionRename}
            renderSlot={renderSlot}
            assignSession={actions.assignSession}
            externalChatSessionId={externalChatSessionId}
            onChatDragEnd={() => { setExternalChatSessionId(null) }}
            setSectionOrder={actions.setSectionOrder}
            toggleSection={(sectionId) => {
              actions.setSectionCollapsed(sectionId, chatSections.collapse[sectionId] !== true)
            }}
            moveSection={actions.moveSection}
            openSectionMenu={openSectionMenu}
            openSessionMenu={openSessionMenu}
            useContextMenu={useContextMenu}
            useContextMenuTarget={useContextMenuTarget}
            useSessionAccess={useSessionAccess}
            t={t}
          />
        )}
      </div>

      {workspaceActionRequest !== null && <WorkspaceDialogs key={`${workspaceActionRequest.action}/${workspaceActionRequest.workspaceId}`}
        request={workspaceActionRequest} workspaces={workspaces} renameWorkspace={renameWorkspace} deleteWorkspace={deleteWorkspace}
        settleWorkspaceAction={settleWorkspaceAction} t={t} />}
      {sectionDialogs}
    </div>
  )
}
