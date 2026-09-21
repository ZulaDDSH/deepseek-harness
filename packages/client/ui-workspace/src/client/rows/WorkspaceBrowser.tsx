/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders the two
 * region icons (search / add workspace) as 36px controls on the shell's shared
 * rail entry path, each requesting expansion through the owner share. Adding
 * is the header button's one action, so it raises the directory flow with no
 * menu in between; the flow and its error dialog live in WorkspacePicker
 * (same package — direct composition, no slot between them).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconCloseFill14, IconProjectAddOutline16, IconSearchOutline16, Menu, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import {
  isWorkspaceColor, isWorkspaceIcon, WORKSPACE_APPEARANCE_COLORS, WORKSPACE_COLORS, WORKSPACE_ICONS,
} from '../appearance.ts'
import type { WorkspaceAppearance, WorkspaceColor, WorkspaceIcon } from '../appearance.ts'
import {
  orderByRecency, pinCurrentBlank, reconcileManualOrder, UNGROUPED_KEY, visibleSessionIds,
} from '../tree.ts'
import { ActivityList } from './ActivityList.tsx'
import { FlatList } from './FlatList.tsx'
import { SearchResults, type RemoteSearchState } from './SearchResults.tsx'
import { SessionTree } from './SessionTree.tsx'
import { ViewOptionsMenu } from './ViewOptionsMenu.tsx'
import { useWorkspaceDialogs } from './WorkspaceDialogs.tsx'
import { sanitizeSearchQuery, SEARCH_QUERY_MAX_CODE_UNITS } from './search-query.ts'
import { FLAT_SESSION_ORDER_KEY } from '../stores.ts'
import { WorkspacePickFlow } from '../WorkspacePicker.tsx'
import { WORKSPACE_ICON_GLYPHS } from './WorkspaceIcons.ts'
import css from './WorkspaceBrowser.module.css'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250
const WORKSPACE_APPEARANCE_STORAGE_KEY = 'dsh.workspace.appearance.v1'

function readWorkspaceAppearances(): Record<string, WorkspaceAppearance> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const value: unknown = JSON.parse(localStorage.getItem(WORKSPACE_APPEARANCE_STORAGE_KEY) ?? '{}')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).flatMap(([workspaceId, appearance]) => {
      if (appearance === null || typeof appearance !== 'object' || Array.isArray(appearance)) return []
      const { color, icon } = appearance as Record<string, unknown>
      return isWorkspaceColor(color) || isWorkspaceIcon(icon)
        ? [[workspaceId, {
          ...(isWorkspaceColor(color) ? { color } : {}),
          ...(isWorkspaceIcon(icon) ? { icon } : {}),
        }]]
        : []
    }))
  } catch {
    return {}
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
  renameSession,
  forkSession,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  archiveSession,
  createWorkspace,
  searchSessions,
  searchResultLimit,
  useDirectoryFlow,
  useHostInfo,
  renderSlot,
  t,
}: WorkspaceBrowserProps) {
  const home = useHostInfo(info => info.home)
  const list = useSessions(state => state)
  const workspaces = useWorkspaces(state => state.items)
  const workspacePhase = useWorkspaces(state => state.phase)
  const workspaceStreamState = useWorkspaces(state => state.state)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const groupBy = useStore(s => s.groupBy)
  const orderBy = useStore(s => s.orderBy)
  const groupExpansion = useStore(s => s.groupExpansion)
  const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount)
  const workspaceReady = workspacePhase === 'ready' && workspaceStreamState !== 'loading'
  const mainSessionId = Object.values(list.byId)
    .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const currentBlank = mainSessionId !== undefined && list.byId[mainSessionId]?.blank === true
    ? mainSessionId
    : undefined
  const [filterColor, setFilterColor] = useState<WorkspaceColor | undefined>(undefined)
  const [filterIcon, setFilterIcon] = useState<WorkspaceIcon | undefined>(undefined)
  const [appearanceByWorkspace, setAppearanceByWorkspace] = useState<Record<string, WorkspaceAppearance>>(readWorkspaceAppearances)
  const [appearanceTarget, setAppearanceTarget] = useState<WorkspaceId | null>(null)
  useEffect(() => {
    localStorage.setItem(WORKSPACE_APPEARANCE_STORAGE_KEY, JSON.stringify(appearanceByWorkspace))
  }, [appearanceByWorkspace])
  const ungroupedMemberIds = useMemo(() => {
    const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
    return list.ids.filter(id => list.byId[id] !== undefined && !accounted.has(id))
  }, [list, workspaces])
  const flatMemberIds = useMemo(
    () => visibleSessionIds(list, archivedSessionIds),
    [archivedSessionIds, list],
  )
  const orderedWorkspaces = useMemo(() => workspaces.map((workspace) => {
    const memberIds = workspace.sessionIds
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(memberIds, list.byId)
      : reconcileManualOrder(memberIds, sessionOrderByAccount[workspace.workspaceId], list.byId)
    return {
      ...workspace,
      sessionIds: pinCurrentBlank(
        baseOrder,
        currentBlank !== undefined && memberIds.includes(currentBlank) ? currentBlank : undefined,
      ),
    }
  }), [currentBlank, list.byId, orderBy, sessionOrderByAccount, workspaces])
  const visibleWorkspaces = useMemo(() => orderedWorkspaces.filter((workspace) => {
    const appearance = appearanceByWorkspace[workspace.workspaceId]
    return (filterColor === undefined || appearance?.color === filterColor)
      && (filterIcon === undefined || appearance?.icon === filterIcon)
  }), [appearanceByWorkspace, filterColor, filterIcon, orderedWorkspaces])
  const orderedUngroupedSessionIds = useMemo(() => {
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(ungroupedMemberIds, list.byId)
      : reconcileManualOrder(ungroupedMemberIds, sessionOrderByAccount[UNGROUPED_KEY], list.byId)
    return pinCurrentBlank(
      baseOrder,
      currentBlank !== undefined && ungroupedMemberIds.includes(currentBlank) ? currentBlank : undefined,
    )
  }, [currentBlank, list.byId, orderBy, sessionOrderByAccount, ungroupedMemberIds])
  const orderedFlatSessionIds = useMemo(() => {
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(flatMemberIds, list.byId)
      : reconcileManualOrder(flatMemberIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY], list.byId)
    return pinCurrentBlank(
      baseOrder,
      currentBlank !== undefined && flatMemberIds.includes(currentBlank) ? currentBlank : undefined,
    )
  }, [currentBlank, flatMemberIds, list.byId, orderBy, sessionOrderByAccount])
  const activeSessionOrders = useMemo<Readonly<Record<string, readonly string[]>>>(() => Object.fromEntries([
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
    if (list.phase !== 'ready' || !workspaceReady || orderBy !== 'manual') return
    const changed = Object.fromEntries(Object.entries(activeSessionOrders).filter(([key, ids]) => {
      const saved = sessionOrderByAccount[key]
      return saved === undefined || saved.length !== ids.length || ids.some((id, index) => id !== saved[index])
    }))
    if (Object.keys(changed).length > 0) actions.syncSessionOrders(changed)
  }, [
    actions.syncSessionOrders,
    activeSessionOrders,
    list.phase,
    orderBy,
    sessionOrderByAccount,
    workspaceReady,
  ])
  const saveSessionOrder = (accountKey: string, order: readonly string[]): void => {
    actions.setSessionOrder(accountKey, order, activeSessionOrders)
  }
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
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLButtonElement>(null)

  const openSearchResult = (sessionId: SessionId): void => {
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
    onSessionRename,
    onSessionArchive,
  } = useWorkspaceDialogs({
    workspaces,
    renameWorkspace,
    renameSession,
    deleteWorkspace,
    archiveSession,
    t,
  })
  const updateAppearance = (workspaceId: WorkspaceId, change: WorkspaceAppearance): void => {
    setAppearanceByWorkspace(current => ({ ...current, [workspaceId]: { ...current[workspaceId], ...change } }))
  }

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
        {wide && (
          <span className={clsx(css.sectionLabel, css.wide, searchExpanded && css.sectionLabelHidden)}>
            {groupBy === 'activity' ? t('groupBy.activity') : groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')}
          </span>
        )}
        {wide && groupBy !== 'flat' && (
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
                setWsPickerOpen(false)
                setSearchExpanded(true)
                searchInput.current?.focus()
              }}
            >
              <Tooltip label={t('search')} side="bottom" delayMs={500} disabled={searchExpanded}>
                <button
                  type="button"
                  className={css.searchButton}
                  aria-label={t('search.sessions.aria')}
                  aria-expanded={searchExpanded}
                  onClick={() => {
                    setWsPickerOpen(false)
                    setSearchExpanded(true)
                  }}
                >
                  <IconSearchOutline16 size={searchExpanded ? 11 : 14} />
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
                  <IconCloseFill14 />
                </button>
              )}
            </div>
          </div>
        )}
        <div className={clsx(css.headerActions, wide && searchExpanded && css.headerActionsHidden)}>
          {wide && (
            <ViewOptionsMenu
              groupBy={groupBy}
              orderBy={orderBy}
              onGroupPick={(mode) => { actions.setGroupBy(mode) }}
              onOrderPick={(mode) => { actions.setOrderBy(mode, activeSessionOrders) }}
              t={t}
            />
          )}
          {/* Adding is the button's one action, so a composition with no
              picking affordance has nothing to offer here: the region hides the
              button rather than leaving a dead one in the header. */}
          {directoryFlowAvailable && (
            <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
              <button
                ref={wsPlusRef}
                type="button"
                className={css.iconButton}
                aria-label={t('workspace.add')}
                onClick={() => {
                  setWsPickerOpen(v => !v)
                }}
              >
                <IconProjectAddOutline16 size={wide ? 16 : 18} />
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
          side="right"
          onPick={(workspaceId) => {
            setWsPickerOpen(false)
            startSession(workspaceId)
          }}
          onClose={() => { setWsPickerOpen(false) }}
        />
      </div>

      {/* The collapsed rail keeps search as its own 36px control. */}
      {!wide && <div className={css.search}>
        <Tooltip label={t('search')}>
          <button
            type="button"
            className={css.searchButton}
            aria-label={t('search.sessions.aria')}
            onClick={() => {
              setSearchExpanded(true)
              setSearchOnExpand(true)
              expandSidebar()
            }}
          >
            <IconSearchOutline16 size={18} />
          </button>
        </Tooltip>
      </div>}

      {/* Always-mounted seat keeps the region's flex slot while the list
          itself is wide-only. */}
      <div className={css.listArea}>
        {wide && (normalizedQuery !== ''
          ? (
            <SearchResults
              usePanelInfo={usePanelInfo}
              useSessions={useSessions}
              useSessionStatus={useSessionStatus}
              open={openSearchResult}
              workspaces={workspaces}
              archivedSessionIds={archivedSessionIds}
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
                useSessionStatus={useSessionStatus}
                usePanelInfo={usePanelInfo}
                open={open}
                forkSession={forkSession}
                onSessionRename={onSessionRename}
                onSessionArchive={onSessionArchive}
                t={t}
              />
            )
            : groupBy === 'flat'
              ? (
                <FlatList
                  usePanelInfo={usePanelInfo}
                  list={list}
                  sessionIds={orderedFlatSessionIds}
                  useSessionStatus={useSessionStatus}
                  open={open} forkSession={forkSession}
                  onSessionRename={onSessionRename} onSessionArchive={onSessionArchive}
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
                  useSessionStatus={useSessionStatus}
                  onSessionRename={onSessionRename}
                  onSessionArchive={onSessionArchive}
                  forkSession={forkSession}
                  workspaces={visibleWorkspaces}
                  appearanceByWorkspace={appearanceByWorkspace}
                  ungroupedSessionIds={orderedUngroupedSessionIds}
                  workspaceReady={workspaceReady}
                  nestWorkspaces={groupBy === 'workspace-tree'}
                  groupExpansion={groupExpansion}
                  setGroupExpanded={actions.setGroupExpanded}
                  setSessionOrder={saveSessionOrder}
                  archivedSessionIds={archivedSessionIds}
                  startSession={startSession}
                  open={open}
                  insertWorkspaceBefore={insertWorkspaceBefore}
                  revealSessionId={revealSessionId}
                  onSessionRevealed={acknowledgeSessionReveal}
                  home={home}
                  t={t}
                  onRenameRequest={onWorkspaceRename}
                  onDeleteRequest={onWorkspaceDelete}
                  onAppearanceRequest={setAppearanceTarget}
                  onAppearanceChange={updateAppearance}
                />
              ))}
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
                onClick={() => { if (appearanceTarget !== null) updateAppearance(appearanceTarget, { color: value }) }}
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
                  onClick={() => { if (appearanceTarget !== null) updateAppearance(appearanceTarget, { icon: value }) }}
                >
                  <Glyph size={16} />
                </button>
              )
            })}
          </div>
        </div>
      </Modal>
      {dialogs}
    </div>
  )
}
