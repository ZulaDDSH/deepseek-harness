// @vitest-environment jsdom
/**
 * Chat Sections as the lower sidebar pane. Sections are a saved visual filter
 * over the Workspace pane: filing a Chat into a section never removes it from
 * its workspace folder, and the Workspaces list above keeps working exactly as
 * it did. The pane's own operations (create, rename, delete, collapse, reorder,
 * drag) and the persisted schema are covered here; the pure derivation lives in
 * sections.client.spec.ts.
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

/** The Sections pane's tree. */
const sectionsPane = (): HTMLElement => screen.getByRole('tree', { name: '分组' })
/** A section's header row inside the pane. */
const header = (name: string): HTMLElement =>
  within(sectionsPane()).getByRole('treeitem', { name: `分组“${name}”的操作` })
/** The Chat rows filed under one section. */
const membersOf = (name: string): HTMLElement[] =>
  within(within(sectionsPane()).getByRole('group', { name })).getAllByRole('treeitem')
  // The section group also contains its own header row.
    .filter(row => row.getAttribute('aria-selected') !== null)
const titlesOf = (rows: readonly HTMLElement[]): (string | undefined)[] =>
  rows.map(row => row.querySelector('[class*="title"]')?.textContent)
/** The Workspace pane's tree (the upper pane). */
const workspaceTree = (): HTMLElement => screen.getByRole('tree', { name: '会话' })
/**
 * Expand the single workspace group so its Chat rows render. Rows inside a
 * folded group are not in the DOM, and filing a Chat needs the row.
 */
function expandWorkspace(name = 'alpha'): void {
  fireEvent.click(screen.getByText(name))
}
/**
 * File a Chat into a section through its row menu, expanding the workspace
 * group first when its rows are still folded.
 */
function fileInto(chatTitle: string, sectionName: string): void {
  const operator = (): HTMLElement | null =>
    screen.queryByRole('button', { name: `会话“${chatTitle}”的操作` })
  if (operator() === null) expandWorkspace()
  fireEvent.click(operator() as HTMLElement)
  fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
  fireEvent.click(screen.getByRole('menuitem', { name: sectionName }))
}

/** Stub a row rect so drop-half detection has geometry to read. */
function stubRect(row: HTMLElement, top = 100): void {
  row.getBoundingClientRect = () => ({
    top, bottom: top + 34, left: 0, right: 200, width: 200, height: 34,
    x: 0, y: top, toJSON: () => ({}),
  })
}

const chats = () => sessionState([summary('chat-a', 3), summary('chat-b', 2), summary('chat-c', 1)])
const oneWorkspace = () => workspaceState([workspace('alpha', ['chat-a', 'chat-b', 'chat-c'])])

describe('Chat Sections pane', () => {
  it('adds no pane and changes nothing until a section exists', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    expect(workspaceTree()).toBeTruthy()
    expect(screen.queryByRole('tree', { name: '分组' })).toBeNull()
    expect(b.store.getSnapshot().chatSections.sections).toEqual([])
  })

  it('renders the pane below the Workspace list without removing it', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    expect(b.store.getSnapshot().chatSections.sections).toHaveLength(1)
    // Both panes are present: the Workspace list does not go away.
    expect(workspaceTree()).toBeTruthy()
    expect(sectionsPane()).toBeTruthy()
    // The pane leads with its own heading.
    expect(screen.getByText('分组')).toBeTruthy()
    // A brand-new section holds nothing yet.
    expect(membersOf('Work')).toEqual([])
  })

  it('files a chat into a section while leaving it in its workspace folder', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    fileInto('chat-b', 'Work')

    expect(b.store.getSnapshot().chatSections.members).toEqual({ 'chat-b': 'section-1' })
    // Present in the Sections pane...
    expect(titlesOf(membersOf('Work'))).toEqual(['chat-b'])
    // ...and still present in its workspace folder above, because the folder
    // remains the single home for the Session.
    const inWorkspace = within(workspaceTree()).getAllByRole('treeitem')
      .filter(row => row.getAttribute('aria-selected') !== null)
    expect(titlesOf(inWorkspace)).toContain('chat-b')
  })

  it('collapses and expands a section without losing its members', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    fileInto('chat-a', 'Work')

    fireEvent.click(header('Work'))
    expect(b.store.getSnapshot().chatSections.collapse).toEqual({ 'section-1': true })
    expect(membersOf('Work')).toEqual([])
    expect(screen.getByText('拖到此处加入分组')).toBeTruthy()

    fireEvent.click(header('Work'))
    expect(b.store.getSnapshot().chatSections.collapse).toEqual({ 'section-1': false })
    expect(titlesOf(membersOf('Work'))).toEqual(['chat-a'])
  })

  it('renames a section and keeps assignments bound to its stable id', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    fileInto('chat-a', 'Work')

    fireEvent.click(screen.getByRole('button', { name: '分组“Work”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const dialog = screen.getByRole('dialog', { name: '重命名分组' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Server Debugging' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '重命名' }))

    expect(b.store.getSnapshot().chatSections.sections).toEqual([
      { id: 'section-1', name: 'Server Debugging' },
    ])
    expect(b.store.getSnapshot().chatSections.members).toEqual({ 'chat-a': 'section-1' })
    expect(titlesOf(membersOf('Server Debugging'))).toEqual(['chat-a'])
  })

  it('deletes a section without deleting its chats', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    fileInto('chat-a', 'Work')

    fireEvent.click(screen.getByRole('button', { name: '分组“Work”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除分组' }))
    const dialog = screen.getByRole('dialog', { name: '删除分组' })
    expect(within(dialog).getByText(/其会话不会被删除/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '删除分组' }))

    expect(b.store.getSnapshot().chatSections.sections).toEqual([])
    expect(b.store.getSnapshot().chatSections.members).toEqual({})
    // With no section left the pane disappears and the Workspace list is the
    // whole region again, with every chat intact in its folder.
    expect(screen.queryByRole('tree', { name: '分组' })).toBeNull()
    expect(titlesOf(within(workspaceTree()).getAllByRole('treeitem'))).toContain('chat-a')
  })

  it('unfiles a chat from the row menu inside the pane', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    fileInto('chat-a', 'Work')

    fireEvent.click(within(sectionsPane()).getByRole('button', { name: '会话“chat-a”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '从分组中移出' }))
    expect(b.store.getSnapshot().chatSections.members).toEqual({})
    expect(membersOf('Work')).toEqual([])
  })

  it('disables the menu row for the section a chat already belongs to', () => {
    mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    createSection('Personal')
    fileInto('chat-a', 'Work')

    // The pane's own row menu offers the current section as a no-op choice
    // (disabled) and every other section as a live one.
    fireEvent.click(within(sectionsPane()).getByRole('button', { name: '会话“chat-a”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到分组' }))
    expect(screen.getByRole('menuitem', { name: 'Work' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('menuitem', { name: 'Personal' }).hasAttribute('disabled')).toBe(false)
  })

  it('files a chat by dropping it on a section header', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    expandWorkspace()
    const source = within(workspaceTree()).getByText('chat-c').closest('[role="treeitem"]') as HTMLElement
    const target = header('Work')
    stubRect(target)
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(target, 'dragOver', 120)
    fireDrag(target, 'drop', 120)
    expect(b.store.getSnapshot().chatSections.members).toEqual({ 'chat-c': 'section-1' })
    // A cross-pane drag must not also select manual ordering in the tree.
    expect(b.store.getSnapshot().orderBy).toBe('updated')
  })

  it('moves a chat between sections and reorders it inside the target', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    createSection('Personal')
    for (const id of ['chat-a', 'chat-b']) fileInto(id, 'Work')
    fileInto('chat-c', 'Personal')

    const source = within(sectionsPane()).getByText('chat-a').closest('[role="treeitem"]') as HTMLElement
    const target = within(sectionsPane()).getByText('chat-c').closest('[role="treeitem"]') as HTMLElement
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
    for (const id of ['chat-a', 'chat-b']) fileInto(id, 'Work')

    const source = within(sectionsPane()).getByText('chat-a').closest('[role="treeitem"]') as HTMLElement
    const target = within(sectionsPane()).getByText('chat-b').closest('[role="treeitem"]') as HTMLElement
    stubRect(target, 300)
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(target, 'drop', 330)

    expect(b.store.getSnapshot().chatSections.sectionOrder['section-1']).toEqual(['chat-b', 'chat-a'])
  })

  it('reorders sections by dragging one header onto another', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    createSection('Personal')
    const personal = header('Personal')
    const work = header('Work')
    stubRect(work, 100)
    fireEvent.dragStart(personal, { dataTransfer: dragData() })
    fireDrag(work, 'drop', 98)
    expect(b.store.getSnapshot().chatSections.sections.map(section => section.name))
      .toEqual(['Personal', 'Work'])
  })

  it('never lets a provisional New Session start a drag', () => {
    // The blank row is the selected provisional Session, so it renders pinned
    // at the head of its workspace group.
    const list = sessionState([summary('blank', 4, { blank: true }), summary('chat-a', 3)], sid('blank'))
    const b = mount({
      useSessions: hook(list),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['blank', 'chat-a'])])),
    })
    createSection('Work')
    const blank = within(workspaceTree()).getByText('新会话').closest('[role="treeitem"]') as HTMLElement
    expect(blank.draggable).toBe(false)
    fireEvent.dragStart(blank, { dataTransfer: dragData() })
    expect(b.store.getSnapshot().chatSections.members).toEqual({})
  })

  it('leaves the Workspace pane, its mode, and its filter untouched', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    // The file action the pane adds must not become the only route: the
    // Workspace list keeps its own mode selection and its filter control.
    expect(screen.getByRole('button', { name: '筛选工作区' })).toBeTruthy()
    createSection('Work')
    expect(screen.getByRole('button', { name: '筛选工作区' })).toBeTruthy()
    expect(b.store.getSnapshot().groupBy).toBe('workspace')

    const pick = (name: string): void => {
      fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
      fireEvent.click(screen.getByRole('menuitem', { name }))
    }
    pick('单列表')
    expect(b.store.getSnapshot().groupBy).toBe('flat')
    expect(workspaceTree()).toBeTruthy()
    // The pane stays mounted through every Workspace-mode switch.
    expect(sectionsPane()).toBeTruthy()
    pick('按工作区树')
    expect(b.store.getSnapshot().groupBy).toBe('workspace-tree')
    expect(sectionsPane()).toBeTruthy()
    pick('按工作区')
    expect(b.store.getSnapshot().groupBy).toBe('workspace')
    expect(sectionsPane()).toBeTruthy()
  })

  it('keeps the header action order and the filter in place in both panes', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    const cluster = (): HTMLElement => screen.getByRole('button', { name: '添加工作区' })
      .closest('[class*="headerActions"]') as HTMLElement
    const actionNames = (): string[] => Array.from(
      cluster().querySelectorAll<HTMLButtonElement>('button[aria-label]'),
    ).map(button => button.getAttribute('aria-label') ?? '')
    // View options and Add workspace keep the order this branch already had;
    // the new section control is appended last, so nothing existing moves.
    expect(actionNames()).toEqual(['视图选项', '添加工作区', '新建分组'])
    expect(screen.getByRole('button', { name: '筛选工作区' })).toBeTruthy()

    createSection('Work')
    expect(b.store.getSnapshot().chatSections.sections).toHaveLength(1)
    expect(actionNames()).toEqual(['视图选项', '添加工作区', '新建分组'])
    expect(screen.getByRole('button', { name: '筛选工作区' })).toBeTruthy()
  })

  it('files a chat into a COLLAPSED section from a workspace row', () => {
    // The collapsed section is the case the operator hits most: an empty
    // section starts expanded, is collapsed once it has content, and its header
    // plus the hint below it are the only visible targets.
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    expandWorkspace()
    // Collapse it first, before anything is filed.
    fireEvent.click(header('Work'))
    expect(b.store.getSnapshot().chatSections.collapse).toEqual({ 'section-1': true })

    const source = within(workspaceTree()).getByText('chat-c').closest('[role="treeitem"]') as HTMLElement
    const target = header('Work')
    stubRect(target, 100)
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(target, 'dragOver', 120)
    fireDrag(target, 'drop', 120)

    expect(b.store.getSnapshot().chatSections.members).toEqual({ 'chat-c': 'section-1' })
    // The section stays collapsed and now reports its member count.
    expect(b.store.getSnapshot().chatSections.collapse).toEqual({ 'section-1': true })
    expect(screen.getByText('1 个会话')).toBeTruthy()
  })

  it('files a chat by dropping on the hint area of a collapsed section', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    expandWorkspace()
    fireEvent.click(header('Work'))

    const source = within(workspaceTree()).getByText('chat-c').closest('[role="treeitem"]') as HTMLElement
    const hint = within(sectionsPane()).getByText('拖到此处加入分组')
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(hint, 'dragOver', 120)
    fireDrag(hint, 'drop', 120)

    expect(b.store.getSnapshot().chatSections.members).toEqual({ 'chat-c': 'section-1' })
  })

  it('restores sections, collapse, and assignments across a remount', () => {
    const b = mount({ useSessions: hook(chats()), useWorkspaces: hook(oneWorkspace()) })
    createSection('Work')
    fileInto('chat-a', 'Work')
    fireEvent.click(header('Work'))
    b.view.unmount()

    mount({ useSessions: b.props.useSessions, useWorkspaces: b.props.useWorkspaces })
    expect(header('Work')).toBeTruthy()
    // The collapsed section survives with its member hidden and its count kept.
    expect(membersOf('Work')).toEqual([])
    expect(screen.getByText('1 个会话')).toBeTruthy()
  })
})
