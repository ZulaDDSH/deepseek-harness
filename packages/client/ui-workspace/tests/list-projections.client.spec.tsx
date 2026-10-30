// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  allowAllAccess, bindSnapshotSelector, contextMenuHook, makeTranslate,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createWorkspaceShortcutControls } from '../src/client/shortcuts.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceBrowserProps } from '../src/client/contract/slots.ts'
import { zh } from '../src/client/locales.ts'
import { ActivityList } from '../src/client/rows/ActivityList.tsx'
import { WorkspaceBrowser } from '../src/client/rows/WorkspaceBrowser.tsx'
import type { RowRenderSlots } from '../src/client/rows/Rows.tsx'
import { createWorkspaceViewStore, FLAT_SESSION_ORDER_KEY } from '../src/client/stores.ts'

afterEach(cleanup)

const sid = (value: string): SessionId => value as SessionId
const t: WorkspaceBrowserProps['t'] = makeTranslate(zh, commonZh)
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const useSessionStatus = (selector: (state: Map<never, never>) => unknown) => selector(new Map<never, never>())
const renderSlot: RowRenderSlots = () => null
const hook = <T,>(snapshot: T) => function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
const idle = { workspaces: {}, sections: {}, sessions: {} }

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { id: sid(id), title: id, displayTitle: id, running: false, blank: false, updatedAt: 1, retainedBy: {}, ...overrides }
}

function sessionList(...rows: SessionSummary[]): SessionListState {
  return {
    ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])),
    phase: 'ready', projectionsBySession: {},
  }
}

function workspace(id: string, sessionIds: readonly string[]): WorkspaceView {
  return {
    workspaceId: id as WorkspaceView['workspaceId'], title: id, path: `/work/${id}`,
    sessionIds: sessionIds.map(sid), createdAt: '', updatedAt: '',
  }
}

function fireDrag(row: HTMLElement, kind: 'dragOver' | 'drop', clientY = 0): void {
  const event = kind === 'dragOver' ? createEvent.dragOver(row) : createEvent.drop(row)
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'dataTransfer', { value: { effectAllowed: '', dropEffect: '', setData: vi.fn() } })
  fireEvent(row, event)
}

function dragData(): Pick<DataTransfer, 'effectAllowed' | 'dropEffect' | 'setData'> {
  return { effectAllowed: 'uninitialized', dropEffect: 'none', setData: vi.fn() }
}

const renderDirectoryFlowOnly: WorkspaceBrowserProps['renderSlot'] = (name: string, owner: object) =>
  name === 'sidebar.workspaces.directoryFlow' && (owner as { open: boolean }).open
    ? <div data-testid="directory-flow" />
    : null

function mountBrowser(
  overrides: Partial<WorkspaceBrowserProps> = {},
  store = createWorkspaceViewStore().create(),
) {
  const controls = createWorkspaceShortcutControls()
  const props: WorkspaceBrowserProps = {
    ...allowAllAccess,
    wide: true,
    expandSidebar: vi.fn(),
    usePanelInfo,
    useSessions: hook(sessionList()),
    useSessionStatus: useSessionStatus as WorkspaceBrowserProps['useSessionStatus'],
    useSessionRetainInfo: () => undefined,
    useResource,
    useWorkspaces: hook({ items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null }),
    useStore: bindSnapshotSelector(store),
    useAppearance: hook(idle),
    useWorkspaceActionRequest: hook(null),
    useSectionActionRequest: hook(null),
    useShortcuts: select => select([]),
    useWorkspaceShortcuts: bindSnapshotSelector(controls.state),
    useDirectoryFlow: bindSnapshotSelector({ getSnapshot: () => true, subscribe: () => () => {} }),
    useHostInfo: selector => selector({ home: undefined, isLoopback: true }),
    useContextMenu: contextMenuHook(),
    useContextMenuTarget: select => select(null),
    actions: store.actions,
    startSession: vi.fn(),
    open: vi.fn(),
    requestSearch: controls.search,
    requestAddWorkspace: controls.add,
    closeAddWorkspace: controls.closeAdd,
    setDirectoryBusy: controls.directoryBusy,
    requestSessionRename: controls.rename,
    notifyArchivedNotOpenable: vi.fn(),
    renameWorkspace: vi.fn(async () => {}),
    deleteWorkspace: vi.fn(async () => {}),
    settleWorkspaceAction: vi.fn(),
    settleSectionAction: vi.fn(),
    openWorkspaceMenu: vi.fn(),
    openSessionMenu: vi.fn(),
    openSectionMenu: vi.fn(),
    insertWorkspaceBefore: vi.fn(async () => {}),
    unarchiveSession: vi.fn(async () => {}),
    createWorkspace: vi.fn(async () => workspace('created', [])),
    newSectionId: () => 'section-1',
    searchSessions: vi.fn(async () => ({ items: [], hasMore: false })),
    searchResultLimit: 20,
    renderSlot: renderDirectoryFlowOnly,
    t,
    ...overrides,
  }
  return { ...render(<WorkspaceBrowser {...props} />), props, store }
}

it('keeps a revealed chat beyond the collapsed limit visible across Host list refreshes', () => {
  Element.prototype.scrollIntoView = vi.fn()
  const rows = Array.from({ length: 8 }, (_, index) => summary(`chat-${String(index)}`))
  const ids = rows.map(row => row.id)
  const view = mountBrowser({
    useSessions: hook(sessionList(...rows)),
    useWorkspaces: hook({
      items: [workspace('workspace', ids)], archivedSessionIds: [], pinnedSessionIds: [],
      state: 'idle', phase: 'ready', error: null,
    }),
  })
  fireEvent.change(screen.getByPlaceholderText('搜索会话名称'), { target: { value: 'chat-7' } })
  fireEvent.click(screen.getByRole('treeitem'))
  expect(screen.getByText('chat-7')).toBeTruthy()
  view.rerender(<WorkspaceBrowser {...view.props} useSessions={hook(sessionList(...rows))} />)
  expect(screen.getByText('chat-7')).toBeTruthy()
})

describe('ActivityList row actions', () => {
  it('opens the registry Session menu for the captured activity row', () => {
    const openSessionMenu = vi.fn()
    const sessions = sessionList(summary('job', { running: true }))
    render(<ActivityList
      list={sessions} sessionIds={sessions.ids} rowState={{ pinnedSessionIds: [], archivedSessionIds: [], archivedFilter: 'default' }}
      appearanceBySession={{}} openSessionMenu={openSessionMenu} useContextMenu={contextMenuHook()}
      useContextMenuTarget={select => select(null)} useSessionAccess={allowAllAccess.useSessionAccess}
      useSessionStatus={useSessionStatus as never} usePanelInfo={usePanelInfo} open={vi.fn()}
      onSessionRenameRequest={vi.fn()} renderSlot={renderSlot} t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: '会话“job”的操作' }))
    expect(openSessionMenu).toHaveBeenCalledWith(sid('job'), 'job', { x: 0, y: 0 }, 'toggle')
  })
})

describe('flat list rows', () => {
  it('suppresses main-view selection while a panel is active and restores it afterwards', () => {
    const store = createWorkspaceViewStore().create()
    store.actions.setGroupBy('flat')
    const session = summary('job', { retainedBy: { mainView: 1 } })
    const view = mountBrowser({
      useSessions: hook(sessionList(session)),
      usePanelInfo: selector => selector({ activePanelId: 'settings' as MainPanelId }),
    }, store)
    expect(screen.getByRole('treeitem', { name: /job/ }).getAttribute('aria-selected')).toBe('false')
    view.rerender(<WorkspaceBrowser {...view.props} usePanelInfo={usePanelInfo} />)
    expect(screen.getByRole('treeitem', { name: /job/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('commits a reorder on drag end and ignores the following drag end after a drop', () => {
    const store = createWorkspaceViewStore().create()
    store.actions.setGroupBy('flat')
    store.actions.setOrderBy('manual', {})
    const sessions = sessionList(summary('one', { updatedAt: 3 }), summary('two', { updatedAt: 2 }), summary('three', { updatedAt: 1 }))
    const setSessionOrder = vi.fn(store.actions.setSessionOrder)
    mountBrowser({ useSessions: hook(sessions), actions: { ...store.actions, setSessionOrder } }, store)
    const source = screen.getByText('one').closest('[role="treeitem"]') as HTMLElement
    const target = screen.getByText('three').closest('[role="treeitem"]') as HTMLElement
    target.getBoundingClientRect = () => ({
      top: 100, bottom: 140, left: 0, right: 200, width: 200, height: 40, x: 0, y: 100, toJSON: () => ({}),
    })

    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(target, 'dragOver', 101)
    fireEvent.dragEnd(source)
    expect(setSessionOrder).toHaveBeenCalledWith(FLAT_SESSION_ORDER_KEY, ['two', 'one', 'three'], expect.anything())
    setSessionOrder.mockClear()

    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(target, 'dragOver', 139)
    fireEvent.dragEnd(source)
    expect(setSessionOrder).toHaveBeenCalledWith(FLAT_SESSION_ORDER_KEY, ['two', 'three', 'one'], expect.anything())
    setSessionOrder.mockClear()

    const first = screen.getByText('two').closest('[role="treeitem"]') as HTMLElement
    const last = screen.getByText('one').closest('[role="treeitem"]') as HTMLElement
    last.getBoundingClientRect = () => target.getBoundingClientRect()
    fireEvent.dragStart(first, { dataTransfer: dragData() })
    act(() => {
      fireDrag(last, 'drop', 139)
      fireDrag(last, 'dragOver', 139)
      fireEvent.dragEnd(first)
    })
    expect(setSessionOrder).toHaveBeenCalledOnce()
    expect(setSessionOrder).toHaveBeenCalledWith(FLAT_SESSION_ORDER_KEY, ['three', 'one', 'two'], expect.anything())
    const afterDrop = new Event('dragover', { cancelable: true })
    document.dispatchEvent(afterDrop)
    expect(afterDrop.defaultPrevented).toBe(false)
  })

  it('normalizes a blank drop target after the blank and leaves a self-drop unchanged', () => {
    const store = createWorkspaceViewStore().create()
    store.actions.setGroupBy('flat')
    store.actions.setOrderBy('manual', {})
    const blank = summary('blank', { blank: true, retainedBy: { mainView: 1 } })
    const sessions = sessionList(blank, summary('source'), summary('target'))
    const setSessionOrder = vi.fn(store.actions.setSessionOrder)
    mountBrowser({ useSessions: hook(sessions), actions: { ...store.actions, setSessionOrder } }, store)
    const sourceRow = screen.getByText('source').closest('[role="treeitem"]') as HTMLElement
    const targetRow = screen.getByText('target').closest('[role="treeitem"]') as HTMLElement
    const blankRow = screen.getByText('新会话').closest('[role="treeitem"]') as HTMLElement

    fireEvent.dragStart(targetRow, { dataTransfer: dragData() })
    fireDrag(blankRow, 'dragOver')
    fireDrag(blankRow, 'drop')
    expect(setSessionOrder).toHaveBeenCalledWith(FLAT_SESSION_ORDER_KEY, ['blank', 'target', 'source'], expect.anything())
    setSessionOrder.mockClear()

    fireEvent.dragStart(sourceRow, { dataTransfer: dragData() })
    fireDrag(sourceRow, 'drop')
    expect(setSessionOrder).not.toHaveBeenCalled()
  })

  it('cancels a drag that ends without crossing a row', () => {
    const store = createWorkspaceViewStore().create()
    store.actions.setGroupBy('flat')
    store.actions.setOrderBy('manual', {})
    const setSessionOrder = vi.fn(store.actions.setSessionOrder)
    mountBrowser({
      useSessions: hook(sessionList(summary('one'), summary('two'))),
      actions: { ...store.actions, setSessionOrder },
    }, store)
    const source = screen.getByText('one').closest('[role="treeitem"]') as HTMLElement
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireEvent.dragEnd(source)
    expect(setSessionOrder).not.toHaveBeenCalled()
  })

  it('offers to leave an empty archived-only list', () => {
    const store = createWorkspaceViewStore().create()
    store.actions.setGroupBy('flat')
    store.actions.setArchivedFilter('only')
    mountBrowser({ useSessions: hook(sessionList(summary('active'))) }, store)
    expect(screen.getByText('暂无已归档会话')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看其他会话' }))
    expect(store.getSnapshot().archivedFilter).toBe('default')
  })
})
