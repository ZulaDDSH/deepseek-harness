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
 * action callbacks and hosts no action surface. Browser-local appearance
 * choices and the Chat Sections pane live here and persist per browser.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconCloseFillRegular, IconPlusOutlineRegular, IconProjectAddOutlineRegular, IconSearchOutlineRegular,
  Menu, Modal, Toast, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import {
  isWorkspaceColor, isWorkspaceIcon, WORKSPACE_APPEARANCE_COLORS, WORKSPACE_COLORS, WORKSPACE_ICONS,
} from '../appearance.ts'
import type { WorkspaceAppearance, WorkspaceColor, WorkspaceIcon } from '../appearance.ts'
import type { SessionNode, SessionRowState } from '../tree.ts'
import {
  orderByRecency, pinCurrentBlank, reconcileManualOrder, sessionMemberIds, UNGROUPED_KEY, visibleSessionIds,
} from '../tree.ts'
import { ActivityList } from './ActivityList.tsx'
import { FlatList } from './FlatList.tsx'
import { SearchResults, type RemoteSearchState } from './SearchResults.tsx'
import { SessionTree } from './SessionTree.tsx'
import { ViewOptionsMenu } from './ViewOptionsMenu.tsx'
import { useWorkspaceDialogs } from './WorkspaceDialogs.tsx'
import { sanitizeSearchQuery, SEARCH_QUERY_MAX_CODE_UNITS } from './search-query.ts'
import { FLAT_SESSION_ORDER_KEY } from '../stores.ts'
import { sectionsActive } from '../sections.ts'
import { SectionsList } from './SectionsList.tsx'
import { useSectionDialogs } from './SectionDialogs.tsx'
import { WorkspacePickFlow } from '../WorkspacePicker.tsx'
import { WORKSPACE_ICON_GLYPHS } from './WorkspaceIcons.ts'
import { useNativeDragAcceptance } from './drag.ts'
import css from './WorkspaceBrowser.module.css'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250
const WORKSPACE_APPEARANCE_STORAGE_KEY = 'dsh.workspace.appearance.v1'
const APPEARANCE_STORAGE_KEY = 'dsh.workspace.appearance.v2'

type AppearanceMaps = {
  workspaces: Record<string, WorkspaceAppearance>
  sections: Record<string, WorkspaceAppearance>
  sessions: Record<string, WorkspaceAppearance>
}

function readAppearanceMap(value: unknown): Record<string, WorkspaceAppearance> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([id, appearance]) => {
    if (appearance === null || typeof appearance !== 'object' || Array.isArray(appearance)) return []
    const { color, icon } = appearance as Record<string, unknown>
    return isWorkspaceColor(color) || isWorkspaceIcon(icon)
      ? [[id, {
        ...(isWorkspaceColor(color) ? { color } : {}),
        ...(isWorkspaceIcon(icon) ? { icon } : {}),
      }]]
      : []
  }))
}

function readAppearances(): AppearanceMaps {
  const empty: AppearanceMaps = { workspaces: {}, sections: {}, sessions: {} }
  if (typeof localStorage === 'undefined') return empty
  try {
    const current: unknown = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? 'null')
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      const source = current as Record<string, unknown>
      return {
        workspaces: readAppearanceMap(source.workspaces),
        sections: readAppearanceMap(source.sections),
        sessions: readAppearanceMap(source.sessions),
      }
    }
    return { ...empty, workspaces: readAppearanceMap(JSON.parse(localStorage.getItem(WORKSPACE_APPEARANCE_STORAGE_KEY) ?? '{}')) }
  } catch {
    return empty
  }
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
        <Tooltip label={t('filter.label')} side="bottom" delayMs={500}>
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
  useWorkspaces,
  useStore,
  actions,
  startSession,
  open,
  requestSessionRename,
  notifyArchivedNotOpenable,
  renameWorkspace,
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
  dismissForkError,
  renderSlot,
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
  const [appearances, setAppearances] = useState<AppearanceMaps>(readAppearances)
  const [appearanceTarget, setAppearanceTarget] = useState<WorkspaceId | null>(null)
  useEffect(() => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearances))
  }, [appearances])
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

  const openSearchResult = (sessionId: SessionId): void => {
    if (archivedSessionIds.includes(sessionId)) {
      notifyArchivedNotOpenable()
      return
    }
    setRevealSessionId(sessionId)
    setQuery('')
    setSearchExpanded(false)
    open(sessionId)
  }
  const acknowledgeSessionReveal = (sessionId: SessionId): void => {
    setRevealSessionId(current => current === sessionId ? undefined : current)
  }
  useEffect(() => {
    if (normalizedQuery !== '') setRevealSessionId(undefined)
  }, [normalizedQuery])
  const [searchOnExpand, setSearchOnExpand] = useState(false)
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
    setSearchExpanded(true)
    if (!wide) {
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
      setSearchExpanded(false)
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

  const {
    dialogs,
    onWorkspaceRename,
    onWorkspaceDelete,
  } = useWorkspaceDialogs({
    workspaces,
    storedWorkspaces,
    renameWorkspace,
    deleteWorkspace,
    t,
  })
  // The search results' restore button; the row actions own the rest of the
  // Session verbs as slot entries.
  const onSessionUnarchive = (sessionId: SessionNode['id']): void => {
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
  // Section membership survives a Session leaving the visible list only while
  // the Chat still exists; a departed Session's assignment and saved slot are
  // dropped so the persisted layer cannot grow without bound.
  const sessionAccountKeys = list.ids
  useEffect(() => {
    if (list.phase !== 'ready') return
    actions.retainSectionSessions(sessionAccountKeys)
  }, [actions.retainSectionSessions, list.phase, sessionAccountKeys])
  const updateAppearance = (
    kind: keyof AppearanceMaps,
    id: string,
    change: WorkspaceAppearance,
  ): void => {
    setAppearances((current) => {
      const next = { ...current[kind] }
      const merged = { ...next[id], ...change }
      if (merged.color === undefined && merged.icon === undefined) {
        const { [id]: _removed, ...kept } = next
        return { ...current, [kind]: kept }
      }
      next[id] = merged
      return { ...current, [kind]: next }
    })
  }

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
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
                setSearchExpanded(true)
                searchInput.current?.focus()
              }}
            >
              <Tooltip label={t('search')} shortcutKeys={searchShortcut?.keys} side="bottom" delayMs={500} disabled={searchExpanded}>
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
                  setSearchExpanded(false)
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
                    setSearchExpanded(false)
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
            <Tooltip label={t('workspace.add')} shortcutKeys={addShortcut?.keys} side="bottom" delayMs={500}>
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
            startSession(workspaceId)
          }}
          onClose={() => { closeAddWorkspace() }}
        />
      </div>

      {/* The collapsed rail keeps search as its own 36px control. */}
      {!wide && <div className={css.search}>
        <Tooltip label={t('search')} shortcutKeys={searchShortcut?.keys}>
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
        <div className={clsx(wide && sectionsOn && css.workspacePane)}>
          {wide && (normalizedQuery !== ''
            ? (
              <SearchResults
                usePanelInfo={usePanelInfo}
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
                  onSessionAppearanceChange={(sessionId, change) => { updateAppearance('sessions', sessionId, change) }}
                  useSessionStatus={useSessionStatus}
                  usePanelInfo={usePanelInfo}
                  open={guardedOpen}
                  onSessionRenameRequest={requestSessionRename}
                  renderSlot={renderSlot}
                  t={t}
                />
              )
              : groupBy === 'flat'
                ? (
                  <FlatList
                    usePanelInfo={usePanelInfo}
                    list={list}
                    sessionIds={orderedFlatSessionIds}
                    rowState={rowState}
                    onLeaveArchivedOnly={leaveArchivedOnly}
                    workspaceReady={workspaceReady}
                    animationResetKey={`${groupBy}/${orderBy}/${archivedFilter}`}
                    appearanceBySession={appearances.sessions}
                    onSessionAppearanceChange={(sessionId, change) => { updateAppearance('sessions', sessionId, change) }}
                    useSessionStatus={useSessionStatus}
                    open={guardedOpen}
                    onSessionRenameRequest={requestSessionRename}
                    renderSlot={renderSlot}
                    setSessionOrder={saveSessionOrder}
                    revealSessionId={revealSessionId}
                    onSessionRevealed={acknowledgeSessionReveal}
                    t={t}
                  />
                )
                : (
                  <SessionTree
                    usePanelInfo={usePanelInfo}
                    list={list}
                    shortcuts={shortcuts}
                    useSessionStatus={useSessionStatus}
                    onSessionRenameRequest={requestSessionRename}
                    renderSlot={renderSlot}
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
                    onRenameRequest={onWorkspaceRename}
                    onDeleteRequest={onWorkspaceDelete}
                    onAppearanceRequest={setAppearanceTarget}
                    onAppearanceChange={(workspaceId, change) => { updateAppearance('workspaces', workspaceId, change) }}
                    onSessionAppearanceChange={(sessionId, change) => { updateAppearance('sessions', sessionId, change) }}
                    sectionDropTargets={sectionsOn}
                    assignSession={actions.assignSession}
                    sections={chatSections.sections}
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
            onSectionRename={onSectionRename}
            onSectionDelete={onSectionDelete}
            onSectionAppearanceChange={(sectionId, change) => { updateAppearance('sections', sectionId, change) }}
            onSessionAppearanceChange={(sessionId, change) => { updateAppearance('sessions', sessionId, change) }}
            t={t}
          />
        )}
      </div>

      <Modal
        open={appearanceTarget !== null}
        onClose={() => { setAppearanceTarget(null) }}
        closeLabel={t('close')}
        title={t('appearance.title')}
        footer={<Button variant="outline" onClick={() => { setAppearanceTarget(null) }}>{t('cancel')}</Button>}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <strong>{t('filter.color')}</strong>
          <div style={{ display: 'flex', gap: 8 }}>
            {WORKSPACE_COLORS.map(value => (
              <button
                key={value}
                type="button"
                aria-label={t(`appearance.color.${value}`)}
                style={{ width: 28, height: 28, borderRadius: 14, border: '2px solid transparent', background: WORKSPACE_APPEARANCE_COLORS[value], cursor: 'pointer' }}
                onClick={() => { if (appearanceTarget !== null) updateAppearance('workspaces', appearanceTarget, { color: value }) }}
              />
            ))}
          </div>
          <strong>{t('filter.icon')}</strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {WORKSPACE_ICONS.map((value) => {
              const Glyph = WORKSPACE_ICON_GLYPHS[value]
              return (
                <button
                  key={value}
                  type="button"
                  aria-label={t(`appearance.icon.${value}`)}
                  style={{ width: 32, height: 28, border: '1px solid var(--dsw-alias-border-l3)', background: 'transparent', cursor: 'pointer' }}
                  onClick={() => { if (appearanceTarget !== null) updateAppearance('workspaces', appearanceTarget, { icon: value }) }}
                >
                  <Glyph size={16} />
                </button>
              )
            })}
          </div>
        </div>
      </Modal>
      {dialogs}
      {sectionDialogs}
      {shortcutState.forkError !== null && <Toast key={shortcutState.forkError.seq}
        text={t(shortcutState.forkError.reason === 'unavailable' ? 'shortcut.noCompletedTurn' : 'shortcut.forkFailed')}
        onDone={dismissForkError} />}
    </div>
  )
}
