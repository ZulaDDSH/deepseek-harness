/**
 * The Chat Sections pane: one collapsible section per operator-created
 * grouping, holding the Chats the operator filed into it.
 *
 * Sections are a visual filter over the Workspace pane, not a second
 * membership list: every Chat keeps living in its workspace folder above, and
 * a Chat with no section simply does not appear here. Nothing is ever removed
 * from the Workspace pane by filing it.
 *
 * A Chat dropped on a section header (or on a sibling inside it) joins that
 * section at the drop position, and a section header dropped on another
 * reorders sections. Unfiling happens through the row menu's Remove from
 * section, or by dragging the row back up to its workspace folder.
 */
import { useMemo, useRef, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { WorkspaceAppearance } from '../appearance.ts'
import { deriveFlat, pinCurrentBlank, type SessionNode, type SessionRowState } from '../tree.ts'
import { deriveSections, type SectionNode } from '../sections.ts'
import type { ChatSectionsState } from '../stores.ts'
import { SectionHeaderItem, SessionNodeItem, type RowRenderSlots, type SessionSectionActions } from './Rows.tsx'
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
    | null
}

/** One in-flight section-header drag, used only to reorder sections. */
interface SectionDragState {
  sectionId: string
  over: { id: string; half: 'before' | 'after' } | null
}

export interface SectionsListProps extends Pick<
  WorkspaceBrowserProps,
  'useSessionStatus' | 'open' | 'usePanelInfo' | 't'
> {
  list: SessionListState
  /** Registry-global pin and archive sets plus the archived-visibility choice. */
  rowState: SessionRowState
  /** Visible top-level Sessions in fallback (recency) order. */
  visibleSessionIds: readonly SessionId[]
  /** Persisted section layer. */
  sections: ChatSectionsState
  appearanceBySection: Readonly<Record<string, WorkspaceAppearance>>
  appearanceBySession: Readonly<Record<string, WorkspaceAppearance>>
  /** Selected provisional New Session, pinned first wherever it renders. */
  currentBlank: SessionId | undefined
  /** Open the rename dialog from a row title double-click. */
  onSessionRenameRequest: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** Child-seat renderer for the rows' action lists, leading decoration, and hover section. */
  renderSlot: RowRenderSlots
  /** Assign a Session to a section (or to no section) at the head of its list. */
  assignSession: (sessionId: SessionId, sectionId: string | undefined) => void
  /** Move a Session within, or into, a section at an explicit position. */
  setSectionOrder: (sectionId: string, order: readonly SessionId[]) => void
  toggleSection: (sectionId: string) => void
  /** Move a section to a position relative to another section. */
  moveSection: (sectionId: string, beforeSectionId?: string) => void
  onSectionRename: (sectionId: string, currentName: string) => void
  onSectionDelete: (sectionId: string, name: string) => void
  onSectionAppearanceChange: (sectionId: string, change: WorkspaceAppearance) => void
  onSessionAppearanceChange: (sessionId: SessionId, change: WorkspaceAppearance) => void
  externalChatSessionId: SessionId | null
  onChatDragEnd: () => void
}

/**
 * Render the Chat Sections list.
 * @param props - section layer, visible membership, row actions, and standard hooks.
 * @returns the sections tree body.
 */
export function SectionsList({
  list, rowState, visibleSessionIds, sections, appearanceBySection, appearanceBySession, currentBlank, useSessionStatus, open,
  usePanelInfo, onSessionRenameRequest, renderSlot, assignSession, setSectionOrder,
  toggleSection, moveSection, onSectionRename, onSectionDelete, onSectionAppearanceChange,
  onSessionAppearanceChange, t,
  externalChatSessionId, onChatDragEnd,
}: SectionsListProps) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const statuses = useSessionStatus(s => s)
  const projection = useMemo(
    () => deriveSections(sections, visibleSessionIds, list.byId),
    [list.byId, sections, visibleSessionIds],
  )
  const nodes = useMemo(
    () => new Map(deriveFlat(list, visibleSessionIds, rowState, statuses).map(node => [node.id as string, node])),
    [list, rowState, statuses, visibleSessionIds],
  )
  const currentId = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
  const [chatDrag, setChatDrag] = useState<ChatDragState | null>(null)
  const [sectionDrag, setSectionDrag] = useState<SectionDragState | null>(null)
  // A drag started on a workspace row above is a filing gesture for this pane:
  // its own `chatDrag` only covers reorders begun inside the pane, so the
  // cross-pane case is tracked separately and commits on the header.
  const chatDropCommitted = useRef(false)
  const sectionDropCommitted = useRef(false)
  useNativeDragAcceptance(chatDrag !== null || sectionDrag !== null || externalChatSessionId !== null)

  /** File an externally dragged Chat into a section, then clear the gesture. */
  const commitExternalDrop = (sectionId: string): void => {
    if (externalChatSessionId === null) return
    assignSession(externalChatSessionId, sectionId)
    onChatDragEnd()
  }

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
        onRenameRequest={onSessionRenameRequest}
        renderSlot={renderSlot}
        appearance={appearanceBySession[node.id]}
        appearanceActions={{
          color: (color) => { onSessionAppearanceChange(node.id, { color }) },
          icon: (icon) => { onSessionAppearanceChange(node.id, { icon }) },
        }}
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
        // still-empty section — the section an operator most often drops into.
        onDragOver={(e) => {
          if (externalChatSessionId !== null) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            return
          }
          if (sectionDrag !== null || chatDrag === null) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setChatDrag(active => (active === null ? active : {
            ...active, over: { kind: 'section', id: section.id, half: 'after' },
          }))
        }}
        onDrop={(e) => {
          if (externalChatSessionId !== null) {
            e.preventDefault()
            e.stopPropagation()
            commitExternalDrop(section.id)
            return
          }
          if (sectionDrag !== null || chatDrag === null) return
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
          appearance={appearanceBySection[section.id]}
          dragActive={chatDrag !== null || sectionDrag !== null || externalChatSessionId !== null}
          marker={marker}
          onToggle={() => { toggleSection(section.id) }}
          externalChatSessionId={externalChatSessionId}
          onFileChat={() => { commitExternalDrop(section.id) }}
          onDragOver={() => {
            // The cross-pane gesture files the Chat; the header owns this
            // commit, so the drag never reaches the tree's own reorder path.
            if (externalChatSessionId !== null) return
            if (chatDrag !== null) return
          }}
          onDrop={(half) => {
            if (externalChatSessionId !== null) {
              commitExternalDrop(section.id)
              return
            }
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
            appearanceColor: (color) => { onSectionAppearanceChange(section.id, { color }) },
            appearanceIcon: (icon) => { onSectionAppearanceChange(section.id, { icon }) },
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
    <div className={css.sectionsPane}>
      <div className={css.paneHeading}>{t('section.chats')}</div>
      <div className={css.sectionsScroll} role="tree" aria-label={t('section.chats')}>
        {projection.sections.map(sectionBlock)}
        {projection.sections.length === 0 && (
          <div className={css.paneEmpty}>{t('section.empty')}</div>
        )}
      </div>
      <span className={css.fade} />
    </div>
  )
}
