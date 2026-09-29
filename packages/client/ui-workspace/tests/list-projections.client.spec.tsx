// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../src/client/locales.ts'
import type { RowRenderSlots } from '../src/client/rows/Rows.tsx'
import { ActivityList } from '../src/client/rows/ActivityList.tsx'
import { FlatList, type FlatListProps } from '../src/client/rows/FlatList.tsx'
import { SessionTree } from '../src/client/rows/SessionTree.tsx'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { FLAT_SESSION_ORDER_KEY } from '../src/client/stores.ts'
import type { SessionRowState } from '../src/client/tree.ts'

afterEach(cleanup)

const sid = (value: string): SessionId => value as SessionId
const t: FlatListProps['t'] = makeTranslate(zh, commonZh)
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const useSessionStatus: FlatListProps['useSessionStatus'] = selector => selector(new Map())
const renderSlot: RowRenderSlots = () => null
const rowState: SessionRowState = { pinnedSessionIds: [], archivedSessionIds: [], archivedFilter: 'default' }

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { id: sid(id), title: id, displayTitle: id, running: false, blank: false, updatedAt: 1, retainedBy: {}, ...overrides }
}

function sessionList(...rows: SessionSummary[]): SessionListState {
  return {
    ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])),
    phase: 'ready', projectionsBySession: {},
  }
}

function flatProps(overrides: Partial<FlatListProps> = {}): FlatListProps {
  return {
    list: sessionList(), sessionIds: [], rowState, onLeaveArchivedOnly: vi.fn(), appearanceBySession: {},
    onSessionAppearanceChange: vi.fn(), useSessionStatus, open: vi.fn(), onSessionRenameRequest: vi.fn(),
    renderSlot, usePanelInfo, setSessionOrder: vi.fn(), workspaceReady: true, animationResetKey: 'flat',
    onSessionRevealed: vi.fn(), t, ...overrides,
  }
}

it('keeps a revealed chat beyond the collapsed limit visible across Host list refreshes', () => {
  Element.prototype.scrollIntoView = vi.fn()
  const rows = Array.from({ length: 8 }, (_, index) => summary(`chat-${String(index)}`))
  const onSessionRevealed = vi.fn()
  const props: Parameters<typeof SessionTree>[0] = {
    list: sessionList(...rows), workspaces: [{ workspaceId: 'workspace' as WorkspaceId, title: 'Project', path: '/work',
      sessionIds: rows.map(row => row.id), createdAt: '', updatedAt: '' }],
    shortcuts: [{ id: 'session.new' as ShortcutCommandId, label: 'New', aliases: [], binding: null, keys: ['Ctrl', 'N'],
      aria: 'Control+N', modified: true, conflicts: [], issue: null }],
    appearanceByWorkspace: {}, appearanceBySession: {}, ungroupedSessionIds: [], rowState,
    workspaceReady: true, animationResetKey: 'tree', nestWorkspaces: false, groupExpansion: { workspace: true },
    usePanelInfo, useSessionStatus, renderSlot, startSession: vi.fn(), open: vi.fn(), insertWorkspaceBefore: vi.fn(async () => {}),
    setGroupExpanded: vi.fn(), setSessionOrder: vi.fn(), onLeaveArchivedOnly: vi.fn(),
    onRenameRequest: vi.fn(), onDeleteRequest: vi.fn(), onAppearanceRequest: vi.fn(), onAppearanceChange: vi.fn(),
    onSessionAppearanceChange: vi.fn(), onSessionRenameRequest: vi.fn(), revealSessionId: sid('chat-7'), onSessionRevealed,
    sections: [], assignSession: vi.fn(), onChatDragStart: vi.fn(), onChatDragEnd: vi.fn(), t,
  }
  const view = render(<SessionTree {...props} />)
  expect(screen.getByText('chat-7')).toBeTruthy()
  expect(screen.getByRole('button', { name: '在“Project”中新建会话' }).getAttribute('aria-keyshortcuts')).toBe('Control+N')
  expect(onSessionRevealed).toHaveBeenCalledWith(sid('chat-7'))
  view.rerender(<SessionTree {...props} list={sessionList(...rows)} />)
  expect(screen.getByText('chat-7')).toBeTruthy()
  expect(onSessionRevealed).toHaveBeenCalledWith(sid('chat-7'))
})

function fireDrag(row: HTMLElement, kind: 'dragOver' | 'drop', clientY = 0): void {
  const event = kind === 'dragOver' ? createEvent.dragOver(row) : createEvent.drop(row)
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'dataTransfer', { value: { effectAllowed: '', dropEffect: '', setData: vi.fn() } })
  fireEvent(row, event)
}

function dragData(): Pick<DataTransfer, 'effectAllowed' | 'dropEffect' | 'setData'> {
  return { effectAllowed: 'uninitialized', dropEffect: 'none', setData: vi.fn() }
}

describe('ActivityList row actions', () => {
  it('forwards appearance choices from an activity row menu', () => {
    const onAppearance = vi.fn()
    const sessions = sessionList(summary('job', { running: true }))
    render(<ActivityList
      list={sessions} sessionIds={sessions.ids} rowState={rowState} appearanceBySession={{}}
      onSessionAppearanceChange={onAppearance} useSessionStatus={useSessionStatus} usePanelInfo={usePanelInfo}
      open={vi.fn()} onSessionRenameRequest={vi.fn()} renderSlot={renderSlot} t={t}
    />)

    const actions = screen.getByRole('button', { name: '会话“job”的操作' })
    fireEvent.click(actions)
    fireEvent.click(screen.getByRole('menuitem', { name: '颜色' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '蓝色' }))
    fireEvent.click(actions)
    fireEvent.click(screen.getByRole('menuitem', { name: '图标' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '终端' }))

    expect(onAppearance).toHaveBeenNthCalledWith(1, sid('job'), { color: 'blue' })
    expect(onAppearance).toHaveBeenNthCalledWith(2, sid('job'), { icon: 'terminal' })
  })
})

describe('FlatList row events', () => {
  it('forwards appearance choices and suppresses main-view selection in a panel', () => {
    const session = summary('job', { retainedBy: { mainView: 1 } })
    const sessions = sessionList(session)
    const onAppearance = vi.fn()
    const props = flatProps({
      list: sessions, sessionIds: sessions.ids,
      onSessionAppearanceChange: onAppearance,
      usePanelInfo: selector => selector({ activePanelId: 'settings' as MainPanelId }),
    })
    const view = render(<FlatList {...props} />)
    const row = screen.getByRole('treeitem', { name: /job/ })
    expect(row.getAttribute('aria-selected')).toBe('false')

    const actions = screen.getByRole('button', { name: '会话“job”的操作' })
    fireEvent.click(actions)
    fireEvent.click(screen.getByRole('menuitem', { name: '颜色' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '紫色' }))
    fireEvent.click(actions)
    fireEvent.click(screen.getByRole('menuitem', { name: '图标' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '火箭' }))

    expect(onAppearance).toHaveBeenNthCalledWith(1, session.id, { color: 'purple' })
    expect(onAppearance).toHaveBeenNthCalledWith(2, session.id, { icon: 'rocket' })
    view.rerender(<FlatList {...props} usePanelInfo={usePanelInfo} />)
    expect(screen.getByRole('treeitem', { name: /job/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('commits a reorder on drag end and ignores the following drag end after a drop', () => {
    const sessions = sessionList(summary('one'), summary('two'), summary('three'))
    const setSessionOrder = vi.fn()
    const props = flatProps({ list: sessions, sessionIds: sessions.ids, setSessionOrder })
    render(<FlatList {...props} />)
    const source = screen.getByText('one').closest('[role="treeitem"]') as HTMLElement
    const target = screen.getByText('three').closest('[role="treeitem"]') as HTMLElement
    target.getBoundingClientRect = () => ({
      top: 100, bottom: 140, left: 0, right: 200, width: 200, height: 40, x: 0, y: 100, toJSON: () => ({}),
    })

    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(target, 'dragOver', 101)
    fireEvent.dragEnd(source)
    expect(setSessionOrder).toHaveBeenCalledWith(FLAT_SESSION_ORDER_KEY, ['two', 'one', 'three'])
    setSessionOrder.mockClear()

    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(target, 'dragOver', 139)
    fireEvent.dragEnd(source)
    expect(setSessionOrder).toHaveBeenCalledWith(FLAT_SESSION_ORDER_KEY, ['two', 'three', 'one'])
    setSessionOrder.mockClear()

    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(target, 'dragOver', 139)
    act(() => {
      fireDrag(target, 'drop', 139)
      fireDrag(target, 'dragOver', 139)
      fireEvent.dragEnd(source)
    })
    expect(setSessionOrder).toHaveBeenCalledOnce()
    const afterDrop = new Event('dragover', { cancelable: true })
    document.dispatchEvent(afterDrop)
    expect(afterDrop.defaultPrevented).toBe(false)
  })

  it('normalizes a blank drop target after the blank and leaves a self-drop unchanged', () => {
    const blank = summary('blank', { blank: true, retainedBy: { mainView: 1 } })
    const source = summary('source')
    const target = summary('target')
    const sessions = sessionList(blank, source, target)
    const setSessionOrder = vi.fn()
    render(<FlatList {...flatProps({ list: sessions, sessionIds: sessions.ids, setSessionOrder })} />)
    const sourceRow = screen.getByText('source').closest('[role="treeitem"]') as HTMLElement
    const targetRow = screen.getByText('target').closest('[role="treeitem"]') as HTMLElement
    const blankRow = screen.getByText('新会话').closest('[role="treeitem"]') as HTMLElement

    fireEvent.dragStart(targetRow, { dataTransfer: dragData() })
    fireDrag(blankRow, 'dragOver')
    fireDrag(blankRow, 'drop')
    expect(setSessionOrder).toHaveBeenCalledWith(FLAT_SESSION_ORDER_KEY, ['blank', 'target', 'source'])
    setSessionOrder.mockClear()

    fireEvent.dragStart(sourceRow, { dataTransfer: dragData() })
    fireDrag(sourceRow, 'drop')
    expect(setSessionOrder).not.toHaveBeenCalled()
  })

  it('cancels a drag that ends without crossing a row', () => {
    const sessions = sessionList(summary('one'), summary('two'))
    const setSessionOrder = vi.fn()
    render(<FlatList {...flatProps({ list: sessions, sessionIds: sessions.ids, setSessionOrder })} />)
    const source = screen.getByText('one').closest('[role="treeitem"]') as HTMLElement
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireEvent.dragEnd(source)
    expect(setSessionOrder).not.toHaveBeenCalled()
  })

  it('offers to leave an empty archived-only list', () => {
    const onLeaveArchivedOnly = vi.fn()
    render(<FlatList {...flatProps({
      rowState: { ...rowState, archivedFilter: 'only' }, onLeaveArchivedOnly,
    })} />)
    expect(screen.getByText('暂无已归档会话')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看其他会话' }))
    expect(onLeaveArchivedOnly).toHaveBeenCalledOnce()
  })
})
