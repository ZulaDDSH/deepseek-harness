/** Grouped Workspace and Session tree with browser-local drag ordering. */
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { WorkspaceAppearance } from '../appearance.ts'
import type { GroupNode, SessionNode, SessionRowState } from '../tree.ts'
import {
  deriveGroups, owningGroupKey, owningParentFolder, UNGROUPED_KEY,
} from '../tree.ts'
import { sessionDragOrder, type SessionDragState, useNativeDragAcceptance } from './drag.ts'
import { AnimatedRows } from './AnimatedRows.tsx'
import { EmptySessions } from './EmptySessions.tsx'
import { ProjectRowItem, SessionNodeItem, type RowRenderSlots } from './Rows.tsx'
import type { ChatSection } from '../stores.ts'
import css from './WorkspaceBrowser.module.css'

/** Idle Session rows visible per Workspace before the local overflow control. */
const COLLAPSED_SESSION_LIMIT = 5

/** Keep provisional and running rows outside the idle-session quota, including parents with running children. */
function collapsedSessionRows(sessions: readonly SessionNode[], limit = COLLAPSED_SESSION_LIMIT): {
  rows: readonly SessionNode[]
  hiddenCount: number
} {
  let idleCount = 0
  const rows = sessions.filter((session) => {
    if (session.blank || session.running || session.runningSubagentCount > 0) return true
    if (idleCount >= limit) return false
    idleCount += 1
    return true
  })
  return { rows, hiddenCount: sessions.length - rows.length }
}

/** In-flight Session-row drag; `accountKey` is a Workspace id or {@link UNGROUPED_KEY}. */
type DragState = SessionDragState

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
  'useSessionStatus' | 'startSession' | 'open'
  | 'insertWorkspaceBefore' | 't' | 'usePanelInfo'
> & {
  /** Effective shortcut catalog; the Workspace row's New Session button shows its binding. */
  shortcuts: readonly ShortcutCatalogEntry[]
  /** Child-seat renderer for the rows' action lists, leading decoration, and hover section. */
  renderSlot: RowRenderSlots
  /** Always-mounted Session list snapshot. */
  list: SessionListState
  /** Host account home for POSIX hover-path abbreviation. */
  home?: string | undefined
  /** Workspaces in Host group order with browser-projected Session order. */
  workspaces: readonly WorkspaceView[]
  appearanceByWorkspace: Readonly<Record<string, WorkspaceAppearance>>
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
  /** Open the browser-owned rename dialog for a real Workspace group. */
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned delete-confirmation dialog for a real Workspace group. */
  onDeleteRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  onAppearanceRequest: (workspaceId: WorkspaceId) => void
  /** Apply an appearance change straight from a row menu, without the dialog. */
  onAppearanceChange: (workspaceId: WorkspaceId, change: WorkspaceAppearance) => void
  appearanceBySession: Readonly<Record<string, WorkspaceAppearance>>
  onSessionAppearanceChange: (sessionId: SessionId, change: WorkspaceAppearance) => void
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
  /** The sections a dragged Chat can be filed into. */
  sections: readonly ChatSection[]
  /** File a Chat into a section (or no section) from a workspace row drop or menu. */
  assignSession: (sessionId: SessionId, sectionId: string | undefined) => void
  onChatDragStart: (sessionId: SessionId) => void
  onChatDragEnd: () => void
}

/**
 * Render the scrolling Workspace/Session tree and its drag ordering.
 * @param props - grouped membership, expansion state, navigation actions, and standard hooks.
 * @returns the grouped tree body.
 */
export function SessionTree({
  list, useSessionStatus, startSession, open, workspaces, ungroupedSessionIds, appearanceByWorkspace,
  rowState, onLeaveArchivedOnly,
  workspaceReady, animationResetKey, usePanelInfo,
  onRenameRequest, onDeleteRequest, onAppearanceRequest, onAppearanceChange, onSessionRenameRequest,
  renderSlot, shortcuts,
  appearanceBySession, onSessionAppearanceChange,
  insertWorkspaceBefore,
  nestWorkspaces, groupExpansion, setGroupExpanded,
  setSessionOrder, home, t,
  revealSessionId, onSessionRevealed, sectionDropTargets = false, sections, assignSession,
  onChatDragStart, onChatDragEnd,
}: SessionTreeProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const statuses = useSessionStatus(s => s)
  const current = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const revealGroup = revealSessionId === undefined || !workspaceReady
    ? undefined
    : owningGroupKey(workspaces, revealSessionId)
  const [sessionLimits, setSessionLimits] = useState<Readonly<Record<string, number>>>({})
  const [drag, setDrag] = useState<DragState | null>(null)
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
  useEffect(() => {
    if (revealSessionId === undefined || revealGroup === undefined) return
    const group = groups.find(candidate => candidate.key === revealGroup)
    if (group === undefined || !group.expanded || !group.sessions.some(row => row.id === revealSessionId)) return
    if (collapsedSessionRows(group.sessions).rows.some(row => row.id === revealSessionId)) return
    setSessionLimits(limits => limits[revealGroup] === Infinity ? limits : { ...limits, [revealGroup]: Infinity })
  }, [groups, revealGroup, revealSessionId])
  const now = Date.now()
  const commitSessionDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
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
    const renderedSessions = collapsedSessionRows(group.sessions, sessionLimits[group.key]).rows
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
  const rootGroups = childrenByParent.get(undefined) ?? []
  const workspaceDropAtListStart = rootGroups[0]?.workspaceId !== undefined
    && workspaceDrag?.over?.id === rootGroups[0].workspaceId
    && workspaceDrag.over.half === 'before'

  const rowKeys: string[] = groups.length === 0 ? ['empty'] : []
  const renderGroup = (group: GroupNode, depth: number): ReactNode => {
    const workspaceId = group.workspaceId
    const children = childrenByParent.get(group.key) ?? []
    const compatibleDrag = workspaceDrag !== null && parents.get(workspaceDrag.workspaceId) === parents.get(group.key)
    const collapsed = collapsedSessionRows(group.sessions)
    const visible = collapsedSessionRows(group.sessions, sessionLimits[group.key])
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
          containsCurrentDescendant={currentAncestors.has(group.key)}
          home={home}
          t={t}
          onToggle={() => {
            if (group.expanded) {
              setSessionLimits(limits => ({ ...limits, [group.key]: COLLAPSED_SESSION_LIMIT }))
            }
            setGroupExpanded(group.key, !group.expanded)
          }}
          onCreate={() => {
            if (group.workspaceId !== undefined) {
              setGroupExpanded(group.key, true)
              startSession(group.workspaceId)
            }
          }}
          drag={workspaceDragProps}
          actions={group.workspaceId === undefined
            ? undefined
            : {
              rename: () => {
              /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                if (group.workspaceId !== undefined) onRenameRequest(group.workspaceId, group.label)
              },
              delete: () => {
              /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                if (group.workspaceId !== undefined) onDeleteRequest(group.workspaceId, group.label)
              },
              appearance: () => {
                if (group.workspaceId !== undefined) onAppearanceRequest(group.workspaceId)
              },
              appearanceColor: (color) => {
                if (group.workspaceId !== undefined) onAppearanceChange(group.workspaceId, { color })
              },
              appearanceIcon: (icon) => {
                if (group.workspaceId !== undefined) onAppearanceChange(group.workspaceId, { icon })
              },
            }}
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
              // Publish so the Sections pane can accept this same gesture as a
              // filing drop; it owns that commit, this tree owns reordering.
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
              appearance={group.workspaceId === undefined
                ? appearanceBySession[node.id]
                : { ...appearanceByWorkspace[group.workspaceId], ...appearanceBySession[node.id] }}
              appearanceActions={{
                color: (color) => { onSessionAppearanceChange(node.id, { color }) },
                icon: (icon) => { onSessionAppearanceChange(node.id, { icon }) },
              }}
              onReveal={node.id === revealSessionId && group.key === revealGroup
                ? () => { onSessionRevealed(node.id) }
                : undefined}
              drag={dragProps}
              sectionActions={sectionDropTargets
                ? {
                  sections,
                  currentSectionId: undefined,
                  move: (id, sectionId) => { assignSession(id, sectionId) },
                }
                : undefined}
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
              setSessionLimits(limits => ({
                ...limits,
                [group.key]: sessionsExpanded
                  ? COLLAPSED_SESSION_LIMIT
                  : visible.hiddenCount <= COLLAPSED_SESSION_LIMIT
                    ? Infinity
                    : (limits[group.key] ?? COLLAPSED_SESSION_LIMIT) + COLLAPSED_SESSION_LIMIT,
              }))
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
    <div className={clsx(css.treeBody, css.wide)}>
      {workspaceDropAtListStart && <span className={css.listTopDropIndicator} aria-hidden="true" />}
      <AnimatedRows
        className={clsx(css.list, workspaceDropAtListStart && css.listTopDropActive)}
        label={t('section.sessions')}
        rowKeys={rowKeys}
        ready={list.phase === 'ready' && workspaceReady && !nativeDragActive}
        resetKey={JSON.stringify([animationResetKey, sessionLimits])}
      >
        {groups.length === 0 && (
          <EmptySessions rowState={rowState} onLeaveArchivedOnly={onLeaveArchivedOnly} t={t} />
        )}
        {groupRows}
      </AnimatedRows>
      <span className={css.fade} />
    </div>
  )
}
