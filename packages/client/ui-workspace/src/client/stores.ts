/**
 * The workspace browser's viewing store: the session-list grouping mode and
 * the Chat Sections layer, persisted across reloads. Module level exports the
 * factory only (a module-level handle would pin the store identity across
 * plugin reloads); register() receives the factory and the browser derives its
 * PropsStore share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Browser-local order account for the hierarchy-free flat Session list. */
export const FLAT_SESSION_ORDER_KEY = '__flat_session_order__'

/**
 * Session-list grouping mode: sibling Workspace sections, a Workspace tree,
 * or one flat list. Chat Sections are not a mode: they render in their own
 * pane below the Workspace pane, so this selection keeps governing the
 * Workspace pane while sections exist.
 */
export type SessionGroupBy = 'workspace' | 'workspace-tree' | 'flat'
/** Session order: saved manual positions or current recency. */
export type SessionOrderBy = 'manual' | 'updated'

/** One user-created Chat Section. */
export interface ChatSection {
  /** Stable generated identity; every relationship references this, never the name. */
  id: string
  /** Operator-visible title. */
  name: string
}

/**
 * The Chat Sections organizational layer over Sessions: a lightweight,
 * browser-local grouping that is deliberately not a Workspace. It carries no
 * instructions, files, environment, agent configuration, or shared context —
 * those remain Workspace capabilities. A Session belongs to at most one
 * section ({@link ChatSectionsState.members}); anything unassigned renders in
 * the ordinary ungrouped list.
 */
export interface ChatSectionsState {
  /** Sections in operator display order. */
  sections: ChatSection[]
  /** Explicit collapse per section id; an absent entry means expanded. */
  collapse: Record<string, boolean>
  /** Session id to owning section id. */
  members: Record<string, string>
  /** Saved Session order per section id. */
  sectionOrder: Record<string, string[]>
}

/** Constraint: every existing Session starts ungrouped.
 * @returns a new empty Chat Sections state. */
export function emptyChatSections(): ChatSectionsState {
  return { sections: [], collapse: {}, members: {}, sectionOrder: {} }
}

/**
 * Read the Chat Sections layer out of a rehydrated view state.
 *
 * The persist key predates this field, so a value written by an earlier build
 * carries none; that state migrates to the empty layer, which is what leaves
 * every pre-existing Session ungrouped. A partial or malformed layer degrades
 * field by field rather than dropping the whole view state.
 * @param persisted - the rehydrated value's `chatSections` entry, when present.
 * @returns a complete, mutable Chat Sections layer.
 */
function rehydrateChatSections(persisted: unknown): ChatSectionsState {
  /* v8 ignore next -- a value written before this field existed carries no entry at all. */
  if (persisted === null || typeof persisted !== 'object') return emptyChatSections()
  const source = persisted as Partial<ChatSectionsState>
  return {
    sections: Array.isArray(source.sections)
      ? source.sections.map(section => ({ id: section.id, name: section.name }))
      : [],
    collapse: { ...source.collapse },
    members: { ...source.members },
    sectionOrder: Object.fromEntries(
      Object.entries(source.sectionOrder ?? {}).map(([id, order]) => [id, [...order]]),
    ),
  }
}

/**
 * Bring one rehydrated view state to the current schema.
 *
 * The store persists a whole value and rehydrates by replacement, so every
 * field this key has ever carried needs an explicit default here; the Chat
 * Sections layer is the first such addition and the one this function exists
 * for. `sessionUpdatedAtByAccount` is a retired field that {@link
 * WorkspaceViewActions.retainAccountKeys} strips once the browser mounts.
 * @param persisted - the parsed value from localStorage.
 * @returns the state with every current field populated.
 */
function migrateViewState(persisted: WorkspaceViewState): WorkspaceViewState {
  return { ...persisted, chatSections: rehydrateChatSections(persisted.chatSections) }
}

/** Workspace browser viewing state persisted across surface remounts and reloads. */
type WorkspaceViewState = {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  /** Explicit group expansion keyed by Workspace identity, including descendants in tree mode. */
  groupExpansion: Record<string, boolean>
  /** Saved manual order per Workspace group plus the browser-local flat-list account. */
  sessionOrderByAccount: Record<string, string[]>
  /**
   * Chat Sections layer. A persisted value from before this field existed
   * rehydrates through {@link emptyChatSections}, which is what leaves every
   * pre-existing Session ungrouped.
   */
  chatSections: ChatSectionsState
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type WorkspaceViewActions = {
  setGroupBy: (draft: WorkspaceViewState, mode: SessionGroupBy) => void
  setOrderBy: (
    draft: WorkspaceViewState,
    mode: SessionOrderBy,
    initialOrders: Readonly<Record<string, readonly string[]>>,
  ) => void
  setGroupExpanded: (draft: WorkspaceViewState, key: string, expanded: boolean) => void
  retainAccountKeys: (draft: WorkspaceViewState, workspaceKeys: readonly string[]) => void
  syncSessionOrders: (
    draft: WorkspaceViewState,
    orders: Readonly<Record<string, readonly string[]>>,
  ) => void
  setSessionOrder: (
    draft: WorkspaceViewState,
    accountKey: string,
    order: readonly string[],
    initialOrders: Readonly<Record<string, readonly string[]>>,
  ) => void
  createSection: (draft: WorkspaceViewState, section: ChatSection) => void
  renameSection: (draft: WorkspaceViewState, sectionId: string, name: string) => void
  /** Drop the section record and its assignments; the Sessions themselves are untouched. */
  deleteSection: (draft: WorkspaceViewState, sectionId: string) => void
  setSectionCollapsed: (draft: WorkspaceViewState, sectionId: string, collapsed: boolean) => void
  /** Move a section to `beforeSectionId`, or to the end when it is omitted. */
  moveSection: (draft: WorkspaceViewState, sectionId: string, beforeSectionId?: string) => void
  /** Assign a Session to a section (or to no section) and place it in that list. */
  assignSession: (
    draft: WorkspaceViewState,
    sessionId: string,
    sectionId: string | undefined,
  ) => void
  setSectionOrder: (draft: WorkspaceViewState, sectionId: string, order: readonly string[]) => void
  /** Forget section assignments and saved orders for Sessions that no longer exist. */
  retainSectionSessions: (draft: WorkspaceViewState, liveSessionIds: readonly string[]) => void
}

/** Copy read-only projections into the persisted mutable store representation. */
function copySessionOrders(
  orders: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  return Object.fromEntries(Object.entries(orders).map(([key, order]) => [key, [...order]]))
}

/**
 * Create the workspace browser viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorkspaceViewStore(): EngineStoreHandle<WorkspaceViewState, WorkspaceViewActions> {
  return defineStore({
    init: (): WorkspaceViewState => ({
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrderByAccount: {},
      chatSections: emptyChatSections(),
    }),
    persist: 'dsh.workspace.view.v5',
    migrate: migrateViewState,
    actions: {
      setGroupBy: (d, mode: SessionGroupBy) => { d.groupBy = mode },
      setOrderBy: (d, mode: SessionOrderBy, initialOrders) => {
        if (mode === d.orderBy) return
        d.sessionOrderByAccount = mode === 'manual' ? copySessionOrders(initialOrders) : {}
        d.orderBy = mode
      },
      setGroupExpanded: (d, key: string, expanded: boolean) => { d.groupExpansion[key] = expanded },
      retainAccountKeys: (d, workspaceKeys: readonly string[]) => {
        const retained = new Set(workspaceKeys)
        d.groupExpansion = Object.fromEntries(
          Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)),
        )
        d.sessionOrderByAccount = Object.fromEntries(
          Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)),
        )
        delete (d as WorkspaceViewState & { sessionUpdatedAtByAccount?: unknown }).sessionUpdatedAtByAccount
      },
      syncSessionOrders: (d, orders) => {
        if (d.orderBy !== 'manual') return
        Object.assign(d.sessionOrderByAccount, copySessionOrders(orders))
      },
      setSessionOrder: (d, accountKey, order, initialOrders) => {
        if (d.orderBy === 'updated') d.sessionOrderByAccount = copySessionOrders(initialOrders)
        d.orderBy = 'manual'
        d.sessionOrderByAccount[accountKey] = [...order]
      },
      createSection: (d, section: ChatSection) => {
        d.chatSections.sections.push({ id: section.id, name: section.name })
      },
      renameSection: (d, sectionId: string, name: string) => {
        const section = d.chatSections.sections.find(candidate => candidate.id === sectionId)
        if (section === undefined) return
        section.name = name
      },
      // Deleting a section removes only the grouping: its Sessions keep their
      // logs, membership, and order accounts, and reappear ungrouped.
      deleteSection: (d, sectionId: string) => {
        d.chatSections.sections = d.chatSections.sections.filter(section => section.id !== sectionId)
        d.chatSections.collapse = Object.fromEntries(
          Object.entries(d.chatSections.collapse).filter(([id]) => id !== sectionId),
        )
        d.chatSections.sectionOrder = Object.fromEntries(
          Object.entries(d.chatSections.sectionOrder).filter(([id]) => id !== sectionId),
        )
        d.chatSections.members = Object.fromEntries(
          Object.entries(d.chatSections.members).filter(([, owner]) => owner !== sectionId),
        )
      },
      setSectionCollapsed: (d, sectionId: string, collapsed: boolean) => {
        d.chatSections.collapse[sectionId] = collapsed
      },
      moveSection: (d, sectionId: string, beforeSectionId?: string) => {
        const sections = d.chatSections.sections
        const from = sections.findIndex(section => section.id === sectionId)
        if (from === -1) return
        const [moved] = sections.splice(from, 1)
        /* v8 ignore next -- the index came from this array, so splice always yields the element. */
        if (moved === undefined) return
        const to = beforeSectionId === undefined
          ? sections.length
          : sections.findIndex(section => section.id === beforeSectionId)
        sections.splice(to === -1 ? sections.length : to, 0, moved)
      },
      assignSession: (d, sessionId: string, sectionId: string | undefined) => {
        const previous = d.chatSections.members[sessionId]
        if (previous !== undefined) {
          d.chatSections.sectionOrder[previous] = (d.chatSections.sectionOrder[previous] ?? [])
            .filter(id => id !== sessionId)
        }
        if (sectionId === undefined) {
          d.chatSections.members = Object.fromEntries(
            Object.entries(d.chatSections.members).filter(([id]) => id !== sessionId),
          )
          return
        }
        d.chatSections.members[sessionId] = sectionId
        d.chatSections.sectionOrder[sectionId] = [
          sessionId,
          ...(d.chatSections.sectionOrder[sectionId] ?? []).filter(id => id !== sessionId),
        ]
      },
      setSectionOrder: (d, sectionId: string, order: readonly string[]) => {
        d.chatSections.sectionOrder[sectionId] = [...order]
      },
      retainSectionSessions: (d, liveSessionIds: readonly string[]) => {
        const live = new Set(liveSessionIds)
        d.chatSections.members = Object.fromEntries(
          Object.entries(d.chatSections.members).filter(([sessionId]) => live.has(sessionId)),
        )
        d.chatSections.sectionOrder = Object.fromEntries(
          Object.entries(d.chatSections.sectionOrder)
            .map(([sectionId, order]) => [sectionId, order.filter(id => live.has(id))] as const),
        )
      },
    },
  })
}
