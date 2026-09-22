/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the activity, flat, or grouped tree body, and the
 * workspace dialogs. Wide state renders the full browser; rail state renders
 * the two region icons (search / add workspace) as 36px controls on the shell's
 * shared rail entry path, each requesting expansion through the owner share.
 * Adding is the header button's one action, so it raises the directory flow
 * with no menu in between; the flow and its error dialog live in WorkspacePicker
 * (same package — direct composition, no slot between them).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconCloseFill14, IconProjectAddOutline16, IconSearchOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import {
  orderByRecency, pinCurrentBlank, reconcileManualOrder, UNGROUPED_KEY, visibleSessionIds,
} from '../tree.ts'
import { ActivityList } from './ActivityList.tsx'
import { FlatList } from './FlatList.tsx'
import { SearchResults } from './SearchResults.tsx'
import { SessionTree } from './SessionTree.tsx'
import { ViewOptionsMenu } from './ViewOptionsMenu.tsx'
import { useWorkspaceDialogs } from './WorkspaceDialogs.tsx'
import { SEARCH_QUERY_MAX_CODE_UNITS } from './search-query.ts'
import { useSessionReveal, useWorkspaceSearch } from './search-state.ts'
import { FLAT_SESSION_ORDER_KEY } from '../stores.ts'
import { WorkspacePickFlow } from '../WorkspacePicker.tsx'
import css from './WorkspaceBrowser.module.css'

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
  // Ordering remains live while the rail or search replaces the list body.
  const list = useSessions(state => state)
  const workspaces = useWorkspaces(state => state.items)
  const workspacePhase = useWorkspaces(state => state.phase)
  const workspaceStreamState = useWorkspaces(state => state.state)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  // Live occupancy of this surface's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
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
  // The query outlives the tree and the input (both wide-only) so collapsing
  // does not silently drop an in-progress filter.
  const search = useWorkspaceSearch({ wide, expandSidebar, searchSessions })
  const reveal = useSessionReveal()
  // Section-header + opens the picker menu (same popover in wide and rail
  // states; the menu anchors on this button).
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLButtonElement>(null)

  const openSearchResult = (sessionId: SessionId): void => {
    reveal.open(sessionId)
    search.close()
    open(sessionId)
  }
  const acknowledgeSessionReveal = reveal.acknowledge
  useEffect(() => {
    if (search.normalizedQuery !== '') reveal.clear()
  }, [reveal, search.normalizedQuery])

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

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
        {wide && (
          <span className={clsx(css.sectionLabel, css.wide, search.searchExpanded && css.sectionLabelHidden)}>
            {groupBy === 'activity' ? t('groupBy.activity')
              : groupBy === 'flat' ? t('section.sessions')
                : t('section.workspaces')}
          </span>
        )}
        {wide && (
          <div className={clsx(css.searchSlot, search.searchExpanded && css.searchSlotExpanded)}>
            <div
              ref={search.root}
              className={clsx(css.search, search.searchExpanded && css.searchExpanded)}
              onClick={() => {
                setWsPickerOpen(false)
                search.expand()
                search.input.current?.focus()
              }}
            >
              <Tooltip label={t('search')} side="bottom" delayMs={500} disabled={search.searchExpanded}>
                <button
                  type="button"
                  className={css.searchButton}
                  aria-label={t('search.sessions.aria')}
                  aria-expanded={search.searchExpanded}
                  onClick={() => {
                    setWsPickerOpen(false)
                    search.expand()
                  }}
                >
                  <IconSearchOutline16 size={search.searchExpanded ? 11 : 14} />
                </button>
              </Tooltip>
              <input
                ref={search.input}
                className={css.searchInput}
                type="text"
                placeholder={t('search.placeholder')}
                maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
                value={search.query}
                tabIndex={search.searchExpanded ? 0 : -1}
                onChange={(e) => { search.setQuery(e.target.value) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  search.setQuery('')
                  search.close()
                }}
              />
              {search.searchExpanded && (
                <button
                  type="button"
                  className={css.clearButton}
                  aria-label={t('search.clear')}
                  onClick={(e) => {
                    e.stopPropagation()
                    search.setQuery('')
                    search.close()
                  }}
                >
                  <IconCloseFill14 />
                </button>
              )}
            </div>
          </div>
        )}
        <div className={clsx(css.headerActions, wide && search.searchExpanded && css.headerActionsHidden)}>
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
              search.expandFromRail()
            }}
          >
            <IconSearchOutline16 size={18} />
          </button>
        </Tooltip>
      </div>}

      {/* Always-mounted seat keeps the region's flex slot while the list
          itself is wide-only. */}
      <div className={css.listArea}>
        {wide && (search.normalizedQuery !== ''
          ? (
            <SearchResults
              usePanelInfo={usePanelInfo}
              useSessions={useSessions}
              useSessionStatus={useSessionStatus}
              open={openSearchResult}
              workspaces={workspaces}
              archivedSessionIds={archivedSessionIds}
              query={search.normalizedQuery}
              remote={search.remote}
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
                  revealSessionId={reveal.id}
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
                  workspaces={orderedWorkspaces}
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
                  revealSessionId={reveal.id}
                  onSessionRevealed={acknowledgeSessionReveal}
                  home={home}
                  t={t}
                  onRenameRequest={onWorkspaceRename}
                  onDeleteRequest={onWorkspaceDelete}
                />
              ))}
      </div>

      {dialogs}
    </div>
  )
}
