/**
 * Chat Sections derivation: the lightweight, browser-local organizational
 * layer over Sessions. Sections group Chats only — they carry no Workspace
 * instruction, file, environment, or shared-context meaning, and a Session
 * belongs to at most one section. Sessions outside every section render in
 * the ordinary ungrouped list.
 *
 * Everything here is a pure function of the persisted section layer plus the
 * caller-projected visible Session ids, so the same inputs always produce the
 * same render order.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatSection, ChatSectionsState } from './stores.ts'
import { reconcileManualOrder } from './tree.ts'

/** One Chat Section projected for rendering. */
export interface SectionNode {
  /** Stable section identity; the header keys and every assignment use this, never the name. */
  id: string
  /** Operator-visible title. */
  name: string
  /** Visible member Sessions in render order (empty while collapsed). */
  sessionIds: readonly SessionId[]
  /** Total visible member Sessions, whether or not the section is expanded. */
  sessionCount: number
  expanded: boolean
}

/** The complete Chat Sections projection. */
export interface SectionsProjection {
  sections: readonly SectionNode[]
  /** Visible Sessions outside every section, in the ordinary ungrouped order. */
  ungroupedSessionIds: readonly SessionId[]
}

/**
 * Whether the section layer has anything to render.
 *
 * A section with no members still counts: the operator created it deliberately
 * and needs the header to drop chats into.
 * @param sections - persisted section state.
 * @returns true while at least one section exists or any Session is assigned.
 */
export function sectionsActive(sections: ChatSectionsState): boolean {
  return sections.sections.length > 0 || Object.keys(sections.members).length > 0
}

/**
 * Sections in operator order with their visible member Sessions resolved.
 *
 * Members arrive from the saved per-section order first and then by recency,
 * reusing the same reconciliation the ungrouped and flat accounts use, so a
 * newly discovered Chat joins its section without discarding saved positions.
 * @param sections - persisted section state.
 * @param visibleSessionIds - visible top-level Sessions in fallback (recency) order.
 * @param summaries - current Session summaries used to append newly known members by recency.
 * @returns section nodes plus the ungrouped remainder.
 */
export function deriveSections(
  sections: ChatSectionsState,
  visibleSessionIds: readonly SessionId[],
  summaries: SessionListState['byId'],
): SectionsProjection {
  const visible = new Set<string>(visibleSessionIds)
  const memberOf = new Map<string, string>()
  for (const [sessionId, sectionId] of Object.entries(sections.members)) {
    // A dangling assignment (section deleted out of band, or a Chat whose
    // summary vanished) degrades to ungrouped instead of dropping the Chat.
    if (!visible.has(sessionId)) continue
    if (!sections.sections.some(section => section.id === sectionId)) continue
    memberOf.set(sessionId, sectionId)
  }
  const nodes: SectionNode[] = sections.sections.map((section: ChatSection) => {
    const members = visibleSessionIds.filter(id => memberOf.get(id) === section.id)
    const ordered = reconcileManualOrder(members, sections.sectionOrder[section.id], summaries)
    return {
      id: section.id,
      name: section.name,
      sessionIds: sections.collapse[section.id] === true ? [] : ordered,
      sessionCount: ordered.length,
      expanded: sections.collapse[section.id] !== true,
    }
  })
  return {
    sections: nodes,
    ungroupedSessionIds: visibleSessionIds.filter(id => !memberOf.has(id)),
  }
}
