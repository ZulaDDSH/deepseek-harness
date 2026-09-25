// @vitest-environment jsdom
/**
 * Chat Sections store and derivation. These specs cover the persisted schema
 * and the pure projection; the assembled browser behavior (drag, menus,
 * dialogs) is covered by chat-sections.client.spec.tsx.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  createWorkspaceViewStore, emptyChatSections, type ChatSectionsState,
} from '../src/client/stores.ts'
import { deriveSections, sectionsActive } from '../src/client/sections.ts'

const sid = (id: string): SessionId => id as SessionId

/** Summaries keyed by id, in the list-state shape the derivation reads. */
function summaries(entries: readonly (readonly [string, number])[]): SessionListState['byId'] {
  return Object.fromEntries(entries.map(([id, updatedAt]) => [
    id,
    { id: sid(id), displayTitle: id, running: false, blank: false, updatedAt, retainedBy: {} },
  ]))
}

function layer(overrides: Partial<ChatSectionsState> = {}): ChatSectionsState {
  return { ...emptyChatSections(), ...overrides }
}

afterEach(() => { localStorage.clear() })

describe('Chat Sections persistence', () => {
  it('starts empty so every existing chat is ungrouped', () => {
    const instance = createWorkspaceViewStore().create()
    expect(instance.getSnapshot().chatSections).toEqual(emptyChatSections())
    expect(sectionsActive(instance.getSnapshot().chatSections)).toBe(false)
  })

  it('migrates a view state written before the section layer existed', () => {
    // The exact pre-sections payload: no chatSections key at all.
    localStorage.setItem('dsh.workspace.view.v5', JSON.stringify({
      groupBy: 'flat',
      orderBy: 'manual',
      groupExpansion: { alpha: true },
      sessionOrderByAccount: { alpha: ['older', 'newer'] },
    }))
    const instance = createWorkspaceViewStore().create()
    const state = instance.getSnapshot()
    // Existing fields survive untouched; the new field arrives at its default.
    expect(state.groupBy).toBe('flat')
    expect(state.groupExpansion).toEqual({ alpha: true })
    expect(state.sessionOrderByAccount).toEqual({ alpha: ['older', 'newer'] })
    expect(state.chatSections).toEqual(emptyChatSections())
  })

  it('degrades a partial section layer field by field instead of dropping the view state', () => {
    localStorage.setItem('dsh.workspace.view.v5', JSON.stringify({
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrderByAccount: {},
      chatSections: { sections: [{ id: 's1', name: 'Work' }] },
    }))
    const state = createWorkspaceViewStore().create().getSnapshot()
    expect(state.chatSections.sections).toEqual([{ id: 's1', name: 'Work' }])
    expect(state.chatSections.members).toEqual({})
    expect(state.chatSections.collapse).toEqual({})
    expect(state.chatSections.sectionOrder).toEqual({})
  })

  it('persists sections, ordering, collapse, and assignments across a remount', () => {
    const first = createWorkspaceViewStore().create()
    first.actions.createSection({ id: 'work', name: 'Work' })
    first.actions.createSection({ id: 'personal', name: 'Personal' })
    first.actions.assignSession(sid('a'), 'work')
    first.actions.assignSession(sid('b'), 'work')
    first.actions.assignSession(sid('c'), 'personal')
    first.actions.setSectionCollapsed('work', true)
    first.actions.setSectionOrder('work', [sid('b'), sid('a')])
    first.actions.moveSection('personal', 'work')

    const restored = createWorkspaceViewStore().create().getSnapshot().chatSections
    expect(restored.sections).toEqual([
      { id: 'personal', name: 'Personal' },
      { id: 'work', name: 'Work' },
    ])
    expect(restored.collapse).toEqual({ work: true })
    expect(restored.members).toEqual({ a: 'work', b: 'work', c: 'personal' })
    expect(restored.sectionOrder.work).toEqual(['b', 'a'])
  })
})

describe('Chat Sections operations', () => {
  it('keeps a chat in at most one section when it moves', () => {
    const instance = createWorkspaceViewStore().create()
    instance.actions.createSection({ id: 'work', name: 'Work' })
    instance.actions.createSection({ id: 'personal', name: 'Personal' })
    instance.actions.assignSession(sid('a'), 'work')
    instance.actions.assignSession(sid('a'), 'personal')
    const { members, sectionOrder } = instance.getSnapshot().chatSections
    expect(members).toEqual({ a: 'personal' })
    expect(sectionOrder.work).toEqual([])
    expect(sectionOrder.personal).toEqual(['a'])
  })

  it('removes a chat from its section without deleting the chat', () => {
    const instance = createWorkspaceViewStore().create()
    instance.actions.createSection({ id: 'work', name: 'Work' })
    instance.actions.assignSession(sid('a'), 'work')
    instance.actions.assignSession(sid('a'), undefined)
    expect(instance.getSnapshot().chatSections.members).toEqual({})
    expect(instance.getSnapshot().chatSections.sectionOrder.work).toEqual([])
  })

  it('deletes a section without deleting its chats', () => {
    const instance = createWorkspaceViewStore().create()
    instance.actions.createSection({ id: 'work', name: 'Work' })
    instance.actions.assignSession(sid('a'), 'work')
    instance.actions.assignSession(sid('b'), 'work')
    instance.actions.setSectionCollapsed('work', true)
    instance.actions.deleteSection('work')
    const { chatSections } = instance.getSnapshot()
    expect(chatSections.sections).toEqual([])
    expect(chatSections.members).toEqual({})
    expect(chatSections.sectionOrder).toEqual({})
    expect(chatSections.collapse).toEqual({})

    // The chats themselves are untouched: they render in the ungrouped list.
    const projection = deriveSections(chatSections, [sid('a'), sid('b')], summaries([['a', 2], ['b', 1]]))
    expect(projection.ungroupedSessionIds).toEqual([sid('a'), sid('b')])
  })

  it('renames a section through its stable id and ignores an unknown one', () => {
    const instance = createWorkspaceViewStore().create()
    instance.actions.createSection({ id: 'work', name: 'Work' })
    instance.actions.renameSection('work', 'Server Debugging')
    instance.actions.renameSection('missing', 'Nope')
    expect(instance.getSnapshot().chatSections.sections).toEqual([
      { id: 'work', name: 'Server Debugging' },
    ])
  })

  it('reorders sections, including to the end', () => {
    const instance = createWorkspaceViewStore().create()
    for (const id of ['a', 'b', 'c']) instance.actions.createSection({ id, name: id })
    instance.actions.moveSection('c', 'a')
    expect(instance.getSnapshot().chatSections.sections.map(s => s.id)).toEqual(['c', 'a', 'b'])
    instance.actions.moveSection('c')
    expect(instance.getSnapshot().chatSections.sections.map(s => s.id)).toEqual(['a', 'b', 'c'])
    // An unknown anchor appends rather than dropping the section.
    instance.actions.moveSection('a', 'missing')
    expect(instance.getSnapshot().chatSections.sections.map(s => s.id)).toEqual(['b', 'c', 'a'])
    // A missing source is inert.
    instance.actions.moveSection('missing', 'b')
    expect(instance.getSnapshot().chatSections.sections.map(s => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('forgets assignments and saved slots for chats that no longer exist', () => {
    const instance = createWorkspaceViewStore().create()
    instance.actions.createSection({ id: 'work', name: 'Work' })
    instance.actions.assignSession(sid('a'), 'work')
    instance.actions.assignSession(sid('b'), 'work')
    instance.actions.retainSectionSessions(['a'])
    expect(instance.getSnapshot().chatSections.members).toEqual({ a: 'work' })
    expect(instance.getSnapshot().chatSections.sectionOrder.work).toEqual(['a'])
  })
})

describe('Chat Sections derivation', () => {
  it('orders members by the saved order and appends new ones by recency', () => {
    const sections = layer({
      sections: [{ id: 'work', name: 'Work' }],
      members: { a: 'work', b: 'work', c: 'work' },
      sectionOrder: { work: ['b', 'a'] },
    })
    const projection = deriveSections(sections, [sid('a'), sid('b'), sid('c')], summaries([['a', 1], ['b', 2], ['c', 3]]))
    expect(projection.sections[0]?.sessionIds).toEqual([sid('b'), sid('a'), sid('c')])
    expect(projection.sections[0]?.sessionCount).toBe(3)
    expect(projection.ungroupedSessionIds).toEqual([])
  })

  it('hides members while collapsed but keeps the count', () => {
    const sections = layer({
      sections: [{ id: 'work', name: 'Work' }],
      members: { a: 'work', b: 'work' },
      collapse: { work: true },
    })
    const projection = deriveSections(sections, [sid('a'), sid('b')], summaries([['a', 2], ['b', 1]]))
    expect(projection.sections[0]?.sessionIds).toEqual([])
    expect(projection.sections[0]?.sessionCount).toBe(2)
    expect(projection.sections[0]?.expanded).toBe(false)
  })

  it('returns unassigned chats in their ordinary order', () => {
    const sections = layer({
      sections: [{ id: 'work', name: 'Work' }],
      members: { b: 'work' },
    })
    const projection = deriveSections(sections, [sid('a'), sid('b'), sid('c')], summaries([['a', 3], ['b', 2], ['c', 1]]))
    expect(projection.sections[0]?.sessionIds).toEqual([sid('b')])
    expect(projection.ungroupedSessionIds).toEqual([sid('a'), sid('c')])
  })

  it('degrades a dangling assignment to the ungrouped list instead of dropping the chat', () => {
    const sections = layer({
      sections: [{ id: 'work', name: 'Work' }],
      // 'gone' names a section that no longer exists.
      members: { a: 'work', b: 'gone' },
    })
    const projection = deriveSections(sections, [sid('a'), sid('b')], summaries([['a', 2], ['b', 1]]))
    expect(projection.sections[0]?.sessionIds).toEqual([sid('a')])
    expect(projection.ungroupedSessionIds).toEqual([sid('b')])
  })

  it('keeps an empty section visible so chats have somewhere to land', () => {
    const projection = deriveSections(
      layer({ sections: [{ id: 'new', name: 'Archived Ideas' }] }),
      [sid('a')],
      summaries([['a', 1]]),
    )
    expect(projection.sections).toHaveLength(1)
    expect(projection.sections[0]?.sessionCount).toBe(0)
    expect(projection.ungroupedSessionIds).toEqual([sid('a')])
  })

  it('reports the layer active for sections or assignments alone', () => {
    expect(sectionsActive(layer())).toBe(false)
    expect(sectionsActive(layer({ sections: [{ id: 's', name: 'S' }] }))).toBe(true)
    expect(sectionsActive(layer({ members: { a: 's' } }))).toBe(true)
  })
})
