// @vitest-environment jsdom
/**
 * Chat Sections through the assembled Workspace browser: creating, renaming,
 * and deleting sections, collapsing them, moving chats by drag and by menu,
 * and the ungrouped area that keeps chats reachable. The pure projection and
 * the persisted schema are covered by sections.client.spec.ts.
 */
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { WorkspaceBrowserProps } from '../src/client/contract/slots.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'
import { WorkspaceBrowser } from '../src/client/rows/WorkspaceBrowser.tsx'
import { zh } from '../src/client/locales.ts'

const useResource = (() => ({
  status: 'none' as const, value: undefined, failure: undefined, reload: () => {},
})) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)
let nextSectionId = 1
beforeEach(() => {
  localStorage.clear()
  nextSectionId = 1
})

const t: WorkspaceBrowserProps['t'] = makeTranslate(zh, commonZh)
const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

const summary = (id: string, updatedAt: number, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false, updatedAt, ...overrides,
  retainedBy: overrides.retainedBy ?? {},
})
const sessionState = (items: readonly SessionSummary[], main?: SessionId): SessionListState => {
  const base: SessionListState = {
    ids: items.map(item => item.id),
    byId: Object.fromEntries(items.map(item => [item.id, item])),
    phase: 'ready',
    subagentsByParent: {}, jobsBySession: {},
  }
  if (main === undefined) return base
  const row = base.byId[main]
  if (row === undefined) return base
  return { ...base, byId: { ...base.byId, [main]: { ...row, retainedBy: { ...row.retainedBy, mainView: 1 } } } }
}
const workspace = (id: string, sessionIds: readonly string[], title = id): WorkspaceView => ({
  workspaceId: wid(id), path: `/projects/${id}`, title,
  sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const workspaceState = (items: readonly WorkspaceView[]): WorkspaceSnapshot =>
  ({ items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null })
const noStatuses: SessionStatusSnapshot = new Map()
const hook = <T,>(snapshot: T) => function select<S>(selector: (state: T) => S): S { return selector(snapshot) }

/** jsdom lacks DragEvent — the fireEvent fallback drops clientY, so pin it on the built event. */
function fireDrag(target: HTMLElement, kind: 'dragOver' | 'drop', clientY = 0): void {
  const event = kind === 'dragOver' ? createEvent.dragOver(target) : createEvent.drop(target)
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'dataTransfer', { value: { effectAllowed: '', dropEffect: '', setData: vi.fn() } })
  fireEvent(target, event)
}
const dragData = (): Pick<DataTransfer, 'effectAllowed' | 'dropEffect' | 'setData'> =>
  ({ effectAllowed: 'uninitialized', dropEffect: 'none', setData: vi.fn() })

function mount(overrides: Partial<WorkspaceBrowserProps> = {}) {
  const store = createWorkspaceViewStore().create()
  const props: WorkspaceBrowserProps = {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: hook(sessionState([])),
    useSessionStatus: hook(noStatuses),
    useSessionRetainInfo: () => undefined,
    usePanelInfo, useResource,
    useWorkspaces: hook(workspaceState([])),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    startSession: vi.fn(),
    open: vi.fn(),
    searchSessions: vi.fn(async () => ({ items: [], hasMore: false })),
    searchResultLimit: 20,
    renameSession: vi.fn(async () => {}),
    forkSession: vi.fn(),
    renameWorkspace: vi.fn(async () => {}),
    deleteWorkspace: vi.fn(async () => {}),
    archiveSession: vi.fn(async () => {}),
    insertWorkspaceBefore: vi.fn(async () => {}),
    createWorkspace: vi.fn(async () => workspace('created', [])),
    newSectionId: () => `section-${String(nextSectionId++)}`,
    useDirectoryFlow: bindSnapshotSelector({ getSnapshot: () => true, subscribe: () => () => {} }),
    useHostInfo: selector => selector({ home: undefined, isLoopback: true }),
    renderSlot: ((_name: string, owner: { open: boolean }) => (owner.open ? <div data-testid="directory-flow" /> : null)) as never,
    t,
    ...overrides,
  }
  const view = render(<WorkspaceBrowser {...props} />)
  return { view, props, store }
}

/** Create a section through the header button and its dialog. */
function createSection(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: '新建分组' }))
  const dialog = screen.getByRole('dialog', { name: '新建分组' })
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: name } })
  fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
}

/** The treeitem rows rendered for chats (section headers carry aria-expanded). */
const chatRows = (): HTMLElement[] => screen.getAllByRole('treeitem')
  .filter(row => row.getAttribute('aria-selected') !== null)
const titlesOf = (rows: readonly HTMLElement[]): (string | undefined)[] =>
  rows.map(row => row.querySelector('[class*="title"]')?.textContent)

/** Stub a row rect so drop-half detection has geometry to read. */
function stubRect(row: HTMLElement, top = 100): void {
  row.getBoundingClientRect = () => ({
    top, bottom: top + 34, left: 0, right: 200, width: 200, height: 34,
    x: 0, y: top, toJSON: () => ({}),
  })
}

const chats = () => sessionState([summary('chat-a', 3), summary('chat-b', 2), summary('chat-c', 1)])
const oneWorkspace = () => workspaceState([workspace('alpha', ['chat-a', 'chat-b', 'chat-c'])])

describe('Chat Sections in the browsing region', () => {
  it('keeps the unchanged Workspace projection until a section exists', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    expect(screen.getByRole('tree', { name: '会话' })).toBeTruthy()
    expect(screen.queryByRole('tree', { name: '分组' })).toBeNull()
    expect(screen.queryByText('未分组会话')).toBeNull()
    expect(b.store.getSnapshot().chatSections.sections).toEqual([])
  })

  it('creates a section, moves a chat in by menu, and keeps unassigned chats reachable', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    expect(b.store.getSnapshot().chatSections.sections).toEqual([{ id: 'section-1', name: 'Work' }])
    // The section column replaces the Workspace projection and lists every
    // chat as ungrouped until one is assigned.
    expect(screen.getByRole('tree', { name: '分组' })).toBeTruthy()
    expect(screen.getByRole('group', { name: '未分组会话' })).toBeTruthy()
    expect(titlesOf(chatRows())).toEqual(['chat-a', 'chat-b', 'chat-c'])

    fireEvent.click(screen.getByRole('button', { name: '会话“chat-b”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }))
    expect(b.store.getSnapshot().chatSections.members).toEqual({ 'chat-b': 'section-1' })

    // The moved chat renders under its section; the rest stay ungrouped.
    // The section group also contains its header row, which is not a chat.
    const work = screen.getByRole('group', { name: 'Work' })
    expect(titlesOf(within(work).getAllByRole('treeitem').filter(row => row.getAttribute('aria-selected') !== null)))
      .toEqual(['chat-b'])
    const ungrouped = screen.getByRole('group', { name: '未分组会话' })
    expect(titlesOf(within(ungrouped).getAllByRole('treeitem'))).toEqual(['chat-a', 'chat-c'])
  })

  it('collapses and expands a section without losing its members', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    fireEvent.click(screen.getByRole('button', { name: '会话“chat-a”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }))

    fireEvent.click(screen.getByText('Work'))
    expect(b.store.getSnapshot().chatSections.collapse).toEqual({ 'section-1': true })
    expect(screen.queryByText('chat-a')).toBeNull()
    expect(screen.getByText('拖到此处加入分组')).toBeTruthy()

    fireEvent.click(screen.getByText('Work'))
    expect(b.store.getSnapshot().chatSections.collapse).toEqual({ 'section-1': false })
    expect(screen.getByText('chat-a')).toBeTruthy()
  })

  it('renames a section and keeps assignments bound to its stable id', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    fireEvent.click(screen.getByRole('button', { name: '会话“chat-a”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }))

    fireEvent.click(screen.getByRole('button', { name: '分组“Work”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const dialog = screen.getByRole('dialog', { name: '重命名分组' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Server Debugging' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '重命名' }))

    expect(b.store.getSnapshot().chatSections.sections).toEqual([
      { id: 'section-1', name: 'Server Debugging' },
    ])
    expect(b.store.getSnapshot().chatSections.members).toEqual({ 'chat-a': 'section-1' })
    expect(screen.getByText('Server Debugging')).toBeTruthy()
    expect(screen.getByText('chat-a')).toBeTruthy()
  })

  it('deletes a section without deleting its chats', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    fireEvent.click(screen.getByRole('button', { name: '会话“chat-a”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }))

    fireEvent.click(screen.getByRole('button', { name: '分组“Work”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除分组' }))
    const dialog = screen.getByRole('dialog', { name: '删除分组' })
    expect(within(dialog).getByText(/其会话不会被删除/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '删除分组' }))

    expect(b.store.getSnapshot().chatSections.sections).toEqual([])
    expect(b.store.getSnapshot().chatSections.members).toEqual({})
    // The mode stays on Sections — deleting the last one does not silently move
    // the operator elsewhere — and every chat is back in the ungrouped area, so
    // nothing is lost. Switching away is an ordinary View options pick.
    expect(b.store.getSnapshot().groupBy).toBe('sections')
    const leftover = screen.getByRole('group', { name: '未分组会话' })
    expect(titlesOf(within(leftover).getAllByRole('treeitem'))).toEqual(['chat-a', 'chat-b', 'chat-c'])
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '按工作区' }))
    expect(b.store.getSnapshot().groupBy).toBe('workspace')
    fireEvent.click(screen.getByText('alpha'))
    expect(screen.getByText('chat-a')).toBeTruthy()
  })

  it('moves a chat back to the ungrouped area from its row menu', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    fireEvent.click(screen.getByRole('button', { name: '会话“chat-a”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }))

    fireEvent.click(screen.getByRole('button', { name: '会话“chat-a”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '从分组中移出' }))
    expect(b.store.getSnapshot().chatSections.members).toEqual({})
    const ungrouped = screen.getByRole('group', { name: '未分组会话' })
    expect(titlesOf(within(ungrouped).getAllByRole('treeitem'))).toEqual(['chat-a', 'chat-b', 'chat-c'])
  })

  it('disables the menu row for the section a chat already belongs to', () => {
    mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    createSection('Personal')
    fireEvent.click(screen.getByRole('button', { name: '会话“chat-a”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }))

    fireEvent.click(screen.getByRole('button', { name: '会话“chat-a”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
    expect(screen.getByRole('menuitem', { name: 'Work' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('menuitem', { name: 'Personal' }).hasAttribute('disabled')).toBe(false)
  })

  it('assigns a chat to a section by dropping it on the header', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    const source = screen.getByText('chat-c').closest('[role="treeitem"]') as HTMLElement
    const header = screen.getByText('Work').closest('[role="treeitem"]') as HTMLElement
    stubRect(header)
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(header, 'drop', 120)
    expect(b.store.getSnapshot().chatSections.members).toEqual({ 'chat-c': 'section-1' })
  })

  it('moves a chat between sections and reorders it inside the target', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    createSection('Personal')
    // chat-a and chat-b into Work, chat-c into Personal, all by menu.
    for (const id of ['chat-a', 'chat-b']) {
      fireEvent.click(screen.getByRole('button', { name: `会话“${id}”的操作` }))
      fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }))
    }
    fireEvent.click(screen.getByRole('button', { name: '会话“chat-c”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Personal' }))

    // Drag chat-a on top of chat-c inside Personal.
    const source = screen.getByText('chat-a').closest('[role="treeitem"]') as HTMLElement
    const target = screen.getByText('chat-c').closest('[role="treeitem"]') as HTMLElement
    stubRect(target, 200)
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(target, 'drop', 202)

    const state = b.store.getSnapshot().chatSections
    expect(state.members).toEqual({ 'chat-a': 'section-2', 'chat-b': 'section-1', 'chat-c': 'section-2' })
    expect(state.sectionOrder['section-1']).toEqual(['chat-b'])
    expect(state.sectionOrder['section-2']).toEqual(['chat-a', 'chat-c'])
  })

  it('reorders chats within one section', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    for (const id of ['chat-a', 'chat-b']) {
      fireEvent.click(screen.getByRole('button', { name: `会话“${id}”的操作` }))
      fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }))
    }
    // Head insertion put chat-b first; drag chat-a below chat-b instead.
    const source = screen.getByText('chat-a').closest('[role="treeitem"]') as HTMLElement
    const target = screen.getByText('chat-b').closest('[role="treeitem"]') as HTMLElement
    stubRect(target, 300)
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(target, 'drop', 330)

    expect(b.store.getSnapshot().chatSections.sectionOrder['section-1']).toEqual(['chat-b', 'chat-a'])
  })

  it('returns a chat to the ungrouped area by dropping it there', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    fireEvent.click(screen.getByRole('button', { name: '会话“chat-a”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }))

    const source = screen.getByText('chat-a').closest('[role="treeitem"]') as HTMLElement
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(screen.getByRole('tree', { name: '分组' }), 'drop')
    expect(b.store.getSnapshot().chatSections.members).toEqual({})
  })

  it('reorders sections by dragging one header onto another', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    createSection('Personal')
    const personal = screen.getByText('Personal').closest('[role="treeitem"]') as HTMLElement
    const work = screen.getByText('Work').closest('[role="treeitem"]') as HTMLElement
    stubRect(work, 100)
    fireEvent.dragStart(personal, { dataTransfer: dragData() })
    fireDrag(work, 'drop', 98)
    expect(b.store.getSnapshot().chatSections.sections.map(section => section.name))
      .toEqual(['Personal', 'Work'])
  })

  it('never lets a provisional New Session start a drag', () => {
    const list = sessionState([summary('blank', 4, { blank: true }), summary('chat-a', 3)], sid('blank'))
    const b = mount({
      useSessions: hook(list),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['blank', 'chat-a'])])),
    })
    createSection('Work')
    const blank = screen.getByText('新会话').closest('[role="treeitem"]') as HTMLElement
    expect(blank.draggable).toBe(false)
    fireEvent.dragStart(blank, { dataTransfer: dragData() })
    expect(b.store.getSnapshot().chatSections.members).toEqual({})
  })

  it('keeps every other Group by mode reachable while sections exist', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    // Sections is an ordinary mode: creating one selects it, and the other
    // projections stay selectable, which is what keeps Workspaces, the flat
    // list, and Activity usable after the operator starts organizing chats.
    createSection('Work')
    expect(b.store.getSnapshot().groupBy).toBe('sections')
    const pick = (name: string): void => {
      fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
      fireEvent.click(screen.getByRole('menuitem', { name }))
    }
    pick('按工作区')
    expect(b.store.getSnapshot().groupBy).toBe('workspace')
    expect(screen.getByRole('tree', { name: '会话' })).toBeTruthy()
    expect(screen.queryByRole('tree', { name: '分组' })).toBeNull()

    pick('单列表')
    expect(b.store.getSnapshot().groupBy).toBe('flat')
    expect(screen.getByText('会话')).toBeTruthy()

    pick('活动')
    expect(b.store.getSnapshot().groupBy).toBe('activity')
    expect(screen.getByRole('tree', { name: '活动' })).toBeTruthy()

    pick('分组')
    expect(b.store.getSnapshot().groupBy).toBe('sections')
    expect(screen.getByRole('tree', { name: '分组' })).toBeTruthy()
  })

  it('leaves Add workspace in its leading header position in every mode', () => {
    // The header action cluster is a small, visually-read control row: Add
    // workspace has always led it with the folder-plus glyph, so the section
    // action must not take that slot or reuse that glyph. A regression here is
    // invisible to state assertions and only shows up as a missing button.
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    const cluster = (): HTMLElement => screen.getByRole('button', { name: '添加工作区' })
      .closest('[class*="headerActions"]') as HTMLElement
    const actionNames = (): string[] => Array.from(
      cluster().querySelectorAll<HTMLButtonElement>('button[aria-label]'),
    ).map(button => button.getAttribute('aria-label') ?? '')
    expect(actionNames()).toEqual(['添加工作区', '新建分组', '视图选项'])

    createSection('Work')
    expect(b.store.getSnapshot().groupBy).toBe('sections')
    expect(actionNames()).toEqual(['添加工作区', '新建分组', '视图选项'])

    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '单列表' }))
    expect(actionNames()).toEqual(['添加工作区', '新建分组', '视图选项'])
  })

  it('labels the header for the selected mode', () => {
    mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    const pick = (name: string): void => {
      fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
      fireEvent.click(screen.getByRole('menuitem', { name }))
    }
    // The label names what the list is currently showing, so the operator can
    // tell the WorkSpace view from the Sections view at a glance.
    expect(screen.getByText('工作区')).toBeTruthy()
    pick('分组')
    expect(screen.getByText('分组')).toBeTruthy()
    expect(screen.queryByText('工作区')).toBeNull()
    pick('按工作区')
    expect(screen.getByText('工作区')).toBeTruthy()
  })

  it('restores sections, collapse, and assignments across a remount', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    fireEvent.click(screen.getByRole('button', { name: '会话“chat-a”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }))
    fireEvent.click(screen.getByText('Work'))
    b.view.unmount()

    mount({ useSessions: b.props.useSessions, useWorkspaces: b.props.useWorkspaces })
    // The collapsed section survives with its header, its count, and its
    // member hidden.
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.queryByText('chat-a')).toBeNull()
    expect(screen.getByText('1 个会话')).toBeTruthy()
  })
})
