/**
 * The Chat Sections projection of the browsing region: one collapsible
 * section per operator-created grouping, followed by the Chats that belong to
 * no section. Rendered only while the section layer is active, so a browser
 * with no sections keeps the unchanged Workspace tree / flat / activity
 * projections.
 *
 * Every Chat and section row is a drop target: a Chat dropped on a section
 * header (or a sibling inside it) joins that section and takes the drop
 * position, a Chat dropped in the ungrouped area leaves its section, and a
 * section header dropped on another header reorders sections. The row menus
 * offer the same moves, so the layer stays usable without drag-and-drop.
 */
import { useMemo, useRef, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import { deriveFlat, pinCurrentBlank, type SessionNode } from '../tree.ts'
import { deriveSections, type SectionNode } from '../sections.ts'
import type { ChatSectionsState } from '../stores.ts'
import { SectionHeaderItem, SessionNodeItem, type SessionSectionActions } from './Rows.tsx'
import css from './WorkspaceBrowser.module.css'
import { useNativeDragAcceptance } from './drag.ts'

/** One in-flight Chat drag: the dragged Session plus the current drop marker. */
interface ChatDragState {
  sessionId: SessionNode['id']
  /** Owning section of the dragged Chat at drag start, for cross-section moves. */
  fromSectionId: string | undefined
  over:
    | { kind: 'chat'; id: SessionNode['id']; half: 'before' | 'after'; sectionId: string | undefined }
    | { kind: 'section'; id: string; half: 'before' | 'after' }
    | { kind: 'ungrouped' }
    | null
}

/** One in-flight section-header drag, used only to reorder sections. */
interface SectionDragState {
  sectionId: string
  over: { id: string; half: 'before' | 'after' } | null
}

export interface SectionsListProps extends Pick<
  WorkspaceBrowserProps,
  'useSessionStatus' | 'open' | 'forkSession' | 'usePanelInfo' | 't'
> {
  list: SessionListState
  /** Visible top-level Sessions in fallback (recency) order. */
  visibleSessionIds: readonly SessionId[]
  /** Persisted section layer. */
  sections: ChatSectionsState
  /** Selected provisional New Session, pinned first wherever it renders. */
  currentBlank: SessionId | undefined
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  onSessionArchive: (sessionId: SessionNode['id']) => void
  /** Assign a Session to a section (or to no section) at the head of its list. */
  assignSession: (sessionId: SessionId, sectionId: string | undefined) => void
  /** Move a Session within, or into, a section at an explicit position. */
  setSectionOrder: (sectionId: string, order: readonly SessionId[]) => void
  toggleSection: (sectionId: string) => void
  /** Move a section to a position relative to another section. */
  moveSection: (sectionId: string, beforeSectionId?: string) => void
  onSectionRename: (sectionId: string, currentName: string) => void
  onSectionDelete: (sectionId: string, name: string) => void
}

/**
 * Render the Chat Sections list.
 * @param props - section layer, visible membership, row actions, and standard hooks.
 * @returns the sections tree body.
 */
export function SectionsList({
  list, visibleSessionIds, sections, currentBlank, useSessionStatus, open, forkSession,
  usePanelInfo, onSessionRename, onSessionArchive, assignSession, setSectionOrder,
  toggleSection, moveSection, onSectionRename, onSectionDelete, t,
}: SectionsListProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const statuses = useSessionStatus(s => s)
  const projection = useMemo(
    () => deriveSections(sections, visibleSessionIds, list.byId),
    [list.byId, sections, visibleSessionIds],
  )
  const nodes = useMemo(
    () => new Map(deriveFlat(list, visibleSessionIds, statuses).map(node => [node.id as string, node])),
    [list, statuses, visibleSessionIds],
  )
  const currentId = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const [chatDrag, setChatDrag] = useState<ChatDragState | null>(null)
  const [sectionDrag, setSectionDrag] = useState<SectionDragState | null>(null)
  const chatDropCommitted = useRef(false)
  const sectionDropCommitted = useRef(false)
  useNativeDragAcceptance(chatDrag !== null || sectionDrag !== null)

  const sectionActions = (currentSectionId: string | undefined): SessionSectionActions => ({
    sections: sections.sections,
    currentSectionId,
    move: (id, sectionId) => { assignSession(id, sectionId) },
  })

  /** The selected provisional New Session inside a projected order, if present. */
  const blankIn = (ids: readonly SessionId[]): SessionId | undefined =>
    currentBlank !== undefined && ids.includes(currentBlank) ? currentBlank : undefined

  /**
   * Project one section's member rows into a drag order. A drop between two
   * visible rows inserts relative to the saved list; the blank-pinning rule
   * matches the Workspace tree so a drop never hides its source.
   */
  const commitChatDrop = (activeDrag: ChatDragState, over: NonNullable<ChatDragState['over']>): void => {
    if (chatDropCommitted.current) return
    chatDropCommitted.current = true
    setChatDrag(null)
    if (over.kind === 'section') {
      // Dropped on a section header or its body: join that section at the
      // head of its list, which is the one move a reorder cannot express.
      assignSession(activeDrag.sessionId, over.id)
      return
    }
    if (over.kind === 'ungrouped') {
      // Back to the ungrouped list: the Chat leaves its section and keeps its
      // ordinary account order.
      assignSession(activeDrag.sessionId, undefined)
      return
    }
    const targetSectionId = over.sectionId
    const section = projection.sections.find(candidate => candidate.id === targetSectionId)
    /* v8 ignore next -- rows render only for sections present in the projection. */
    if (section === undefined || targetSectionId === undefined) return
    const rendered = section.sessionIds
    if (!rendered.includes(over.id)) return
    if (over.id === activeDrag.sessionId && activeDrag.fromSectionId === targetSectionId) return
    const withoutSource = rendered.filter(id => id !== activeDrag.sessionId)
    const targetIndex = withoutSource.findIndex(id => id === over.id)
    /* v8 ignore next -- over.id survives the filter unless it is the source, handled above. */
    if (targetIndex === -1) return
    const insertAt = over.half === 'before' ? targetIndex : targetIndex + 1
    const next = [...withoutSource]
    next.splice(insertAt, 0, activeDrag.sessionId)
    // The assignment lands first so the dropped Chat renders in its new
    // section before the explicit order records its slot there.
    assignSession(activeDrag.sessionId, targetSectionId)
    setSectionOrder(targetSectionId, pinCurrentBlank(next, blankIn(next)))
  }

  const commitSectionDrop = (activeDrag: SectionDragState, over: NonNullable<SectionDragState['over']>): void => {
    if (sectionDropCommitted.current) return
    sectionDropCommitted.current = true
    setSectionDrag(null)
    const order = projection.sections
    const rowIndex = order.findIndex(section => section.id === over.id)
    /* v8 ignore next -- headers render only for sections present in the projection. */
    if (rowIndex === -1) return
    const anchor = over.half === 'before' ? over.id : order[rowIndex + 1]?.id
    if (anchor === undefined) {
      // After the last header appends; passing the dragged id itself would be
      // a no-op, which the store's own removal already collapses.
      moveSection(activeDrag.sectionId)
      return
    }
    if (anchor === activeDrag.sectionId) return
    moveSection(activeDrag.sectionId, anchor)
  }

  /** One Chat row, wired for dragging and section assignment. */
  const chatRow = (node: SessionNode, sectionId: string | undefined) => {
    const marker = chatDrag?.over?.kind === 'chat' && chatDrag.over.id === node.id
      ? chatDrag.over.half
      : null
    return (
      <SessionNodeItem
        key={node.id}
        node={node}
        currentId={currentId}
        now={Date.now()}
        onOpen={open}
        onRename={onSessionRename}
        onFork={forkSession}
        onArchive={onSessionArchive}
        flat
        sectionActions={sectionActions(sectionId)}
        drag={{
          start: () => {
            chatDropCommitted.current = false
            setChatDrag({ sessionId: node.id, fromSectionId: sectionId, over: null })
          },
          active: chatDrag !== null,
          marker,
          hover: (half) => {
            setChatDrag(active => (active === null ? active : {
              ...active, over: { kind: 'chat', id: node.id, half, sectionId },
            }))
          },
          drop: (half) => {
            if (chatDrag === null) return
            commitChatDrop(chatDrag, { kind: 'chat', id: node.id, half, sectionId })
          },
          end: () => {
            if (chatDrag?.over !== null && chatDrag?.over !== undefined) commitChatDrop(chatDrag, chatDrag.over)
            else setChatDrag(null)
            chatDropCommitted.current = false
          },
        }}
        t={t}
      />
    )
  }

  /** One section: header (drop target + reorder handle) and its member rows. */
  const sectionBlock = (section: SectionNode) => {
    const marker = sectionDrag?.over?.id === section.id
      ? sectionDrag.over.half
      : chatDrag?.over?.kind === 'section' && chatDrag.over.id === section.id
        ? chatDrag.over.half
        : null
    const joinActive = chatDrag !== null && chatDrag.over?.kind === 'section' && chatDrag.over.id === section.id
    return (
      <div
        key={section.id}
        className={clsx(css.sectionGroup, joinActive && css.sectionJoinActive)}
        role="group"
        aria-label={section.name}
        style={{ '--dsh-workspace-indent': '0px' } as CSSProperties}
        // The body is the header's drop extension: a Chat released anywhere in
        // the section joins it, which is the pointer path for a collapsed or
        // empty section. The header keeps its own before/after boundaries, and
        // that handler stops propagation, so only the member area reaches here.
        onDragOver={chatDrag === null || sectionDrag !== null
          ? undefined
          : (e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setChatDrag(active => (active === null ? active : {
              ...active, over: { kind: 'section', id: section.id, half: 'after' },
            }))
          }}
        onDrop={chatDrag === null || sectionDrag !== null
          ? undefined
          : (e) => {
            e.preventDefault()
            e.stopPropagation()
            setChatDrag((active) => {
              if (active !== null) commitChatDrop(active, { kind: 'section', id: section.id, half: 'after' })
              return null
            })
          }}
      >
        <SectionHeaderItem
          section={section}
          dragActive={chatDrag !== null || sectionDrag !== null}
          marker={marker}
          onToggle={() => { toggleSection(section.id) }}
          onDragOver={(half) => {
            if (sectionDrag !== null) {
              setSectionDrag(active => (active === null ? active : { ...active, over: { id: section.id, half } }))
              return
            }
            if (chatDrag !== null) {
              setChatDrag(active => (active === null ? active : {
                ...active, over: { kind: 'section', id: section.id, half },
              }))
            }
          }}
          onDrop={(half) => {
            if (sectionDrag !== null) {
              commitSectionDrop(sectionDrag, { id: section.id, half })
              return
            }
            setChatDrag((active) => {
              if (active !== null) commitChatDrop(active, { kind: 'section', id: section.id, half })
              return null
            })
          }}
          drag={{
            start: () => {
              sectionDropCommitted.current = false
              setSectionDrag({ sectionId: section.id, over: null })
            },
            end: () => {
              if (sectionDrag?.over !== null && sectionDrag?.over !== undefined) {
                commitSectionDrop(sectionDrag, sectionDrag.over)
              } else {
                setSectionDrag(null)
              }
              sectionDropCommitted.current = false
            },
          }}
          actions={{
            rename: () => { onSectionRename(section.id, section.name) },
            delete: () => { onSectionDelete(section.id, section.name) },
          }}
          t={t}
        />
        {!section.expanded && (
          <div className={css.sectionHint} aria-hidden="true">{t('section.dropHere')}</div>
        )}
        {section.sessionIds.map((id) => {
          const node = nodes.get(id)
          return node === undefined ? null : chatRow(node, section.id)
        })}
      </div>
    )
  }

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div
        className={css.list}
        role="tree"
        aria-label={t('section.chats')}
        onDragOver={chatDrag === null || sectionDrag !== null
          ? undefined
          : (e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setChatDrag(active => (active === null ? active : { ...active, over: { kind: 'ungrouped' } }))
          }}
        onDrop={chatDrag === null || sectionDrag !== null
          ? undefined
          : (e) => {
            e.preventDefault()
            setChatDrag((active) => {
              if (active !== null) commitChatDrop(active, { kind: 'ungrouped' })
              return null
            })
          }}
      >
        {projection.sections.map(sectionBlock)}
        {projection.ungroupedSessionIds.length > 0 && (
          <div className={css.ungroupedBlock} role="group" aria-label={t('section.ungrouped')}>
            <div className={css.activityHeading}>{t('section.ungrouped')}</div>
            {projection.ungroupedSessionIds.map((id) => {
              const node = nodes.get(id)
              return node === undefined ? null : chatRow(node, undefined)
            })}
          </div>
        )}
        {projection.sections.length === 0 && <div className={css.empty}>{t('section.new')}</div>}
      </div>
      <span className={css.fade} />
    </div>
  )
}
