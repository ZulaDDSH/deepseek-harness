// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { QuickSwitcher, type QuickSwitcherProps } from '../src/client/QuickSwitcher.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const sid = (value: string): SessionId => value as SessionId
const wid = (value: string): WorkspaceId => value as WorkspaceId
const t: QuickSwitcherProps['t'] = makeTranslate(zh, commonZh)
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const noStatus = new Map()

function hook<T>(value: T) {
  return function select<S>(selector: (snapshot: T) => S): S { return selector(value) }
}

function summary(id: string, current = false, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sid(id),
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 1,
    retainedBy: current ? { mainView: 1 } : {},
    ...overrides,
  }
}

function sessions(items: readonly SessionSummary[]): SessionListState {
  return {
    ids: items.map(item => item.id),
    byId: Object.fromEntries(items.map(item => [item.id, item])),
    phase: 'ready',
    projectionsBySession: {},
  }
}

function workspace(id: string, title = id): WorkspaceView {
  return {
    workspaceId: wid(id),
    path: `/projects/${id}`,
    title,
    sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function workspaces(items: readonly WorkspaceView[]): WorkspaceSnapshot {
  return { items, archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null }
}

function mount(overrides: Partial<QuickSwitcherProps> = {}) {
  const openSession = vi.fn()
  const openWorkspace = vi.fn(async () => {})
  const quickCommands = vi.fn(async () => [
    { name: 'plan', description: 'Make a plan', kind: 'run' as const },
    { name: 'theme', label: 'Theme', description: 'Choose theme', kind: 'popup' as const },
  ])
  const runQuick = vi.fn(() => true)
  const props: QuickSwitcherProps = {
    useSessions: hook(sessions([
      summary('current', true, { displayTitle: 'Current task', cwd: '/projects/a' }),
      summary('other', false, { displayTitle: 'Other task', cwd: '/projects/b' }),
    ])),
    useWorkspaces: hook(workspaces([
      workspace('alpha', 'Alpha Workspace'),
      workspace('beta', 'Beta Workspace'),
    ])),
    useSessionStatus: hook(noStatus),
    useSessionRetainInfo: () => undefined,
    usePanelInfo,
    useResource,
    openSession,
    openWorkspace,
    quickCommands,
    runQuick,
    t,
    ...overrides,
  }
  const view = render(<QuickSwitcher {...props} />)
  return { view, props, openSession, openWorkspace, quickCommands, runQuick }
}

function openPalette(): void {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
}

describe('QuickSwitcher', () => {
  it('clamps keyboard selection when rows disappear and hides commands without their Session', async () => {
    const quickCommands = vi.fn<QuickSwitcherProps['quickCommands']>(async () => [{ name: 'plain', kind: 'run' }])
    const b = mount({ quickCommands })
    openPalette()
    const input = await screen.findByRole('textbox')
    await screen.findByText('/plain')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    b.view.rerender(<QuickSwitcher {...b.props} useSessions={hook(sessions([summary('current', true)]))} useWorkspaces={hook(workspaces([]))} />)
    expect(screen.getByRole('option', { name: /plain/ }).getAttribute('aria-selected')).toBe('true')
    b.view.rerender(<QuickSwitcher {...b.props} useSessions={hook(sessions([]))} useWorkspaces={hook(workspaces([]))} />)
    expect(screen.queryByText('/plain')).toBeNull()
    expect(screen.getByText(zh['quick.empty'])).toBeTruthy()
  })

  it('ignores unrelated shortcuts and navigates with arrows, hover, and focus', async () => {
    const b = mount()
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'k' })
    expect(screen.queryByRole('dialog')).toBeNull()
    openPalette()
    const input = await screen.findByRole('textbox')
    await screen.findByText('/plan')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: /Theme/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /Current task/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Tab' })
    fireEvent.mouseEnter(screen.getByRole('option', { name: /Other task/ }))
    fireEvent.focusIn(screen.getByRole('option', { name: /Beta Workspace/ }))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(b.openWorkspace).toHaveBeenCalledWith(wid('beta'))
  })

  it('omits missing, archived, and subagent Sessions and supports empty navigation', async () => {
    const state = sessions([summary('archived'), summary('child', false, { origin: 'subagent' }), summary('plain')])
    state.ids.push(sid('missing'))
    const workspaceState = { ...workspaces([]), archivedSessionIds: [sid('archived')] }
    mount({ useSessions: hook(state), useWorkspaces: hook(workspaceState) })
    openPalette()
    const input = await screen.findByRole('textbox')
    expect(screen.queryByText('archived')).toBeNull()
    expect(screen.queryByText('child')).toBeNull()
    expect(screen.getByText('plain')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'absent' } })
    expect(screen.getByText('没有匹配项')).toBeTruthy()
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter']) fireEvent.keyDown(input, { key })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('shows command loading and failure without losing local navigation', async () => {
    let reject: ((reason: Error) => void) | undefined
    const quickCommands: QuickSwitcherProps['quickCommands'] = () => new Promise((_resolve, fail) => { reject = fail })
    const b = mount({ quickCommands })
    openPalette()
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'unmatched' } })
    expect(await screen.findByText(zh['quick.loading'])).toBeTruthy()
    if (reject === undefined) throw new Error('command request did not start')
    reject(new Error('offline'))
    await screen.findByText('没有匹配项')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByText('Current task'))
    expect(b.openSession).toHaveBeenCalledOnce()
  })

  it('ignores command responses and failures after their request is aborted', async () => {
    let resolve: ((value: readonly []) => void) | undefined
    let reject: ((error: Error) => void) | undefined
    const quickCommands = vi.fn<QuickSwitcherProps['quickCommands']>()
      .mockImplementationOnce(() => new Promise((finish) => { resolve = finish }))
      .mockImplementationOnce(() => new Promise((_finish, fail) => { reject = fail }))
    mount({ quickCommands })
    openPalette()
    await screen.findByRole('textbox')
    openPalette()
    if (resolve === undefined) throw new Error('command request did not start')
    resolve([])
    openPalette()
    await screen.findByRole('textbox')
    openPalette()
    if (reject === undefined) throw new Error('second command request did not start')
    reject(new Error('cancelled'))
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens from Ctrl/Cmd+K with Sessions, Workspaces, and current-Session commands', async () => {
    const b = mount()
    openPalette()

    expect(await screen.findByRole('dialog', { name: '快速切换' })).toBeTruthy()
    expect(screen.getByText('Current task')).toBeTruthy()
    expect(screen.getByText('Alpha Workspace')).toBeTruthy()
    await waitFor(() => { expect(b.quickCommands).toHaveBeenCalledWith(sid('current'), '', expect.any(AbortSignal)) })
    expect(await screen.findByText('/plan')).toBeTruthy()
    expect(screen.getByText('Theme')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '搜索会话、工作区和命令…' })).toBe(document.activeElement)
  })

  it('filters local rows and refreshes commands without replacing any composer draft', async () => {
    const b = mount()
    openPalette()
    const input = await screen.findByRole('textbox', { name: '搜索会话、工作区和命令…' })
    fireEvent.change(input, { target: { value: 'beta' } })

    expect(screen.queryByText('Current task')).toBeNull()
    expect(screen.getByText('Beta Workspace')).toBeTruthy()
    await waitFor(() => {
      expect(b.quickCommands).toHaveBeenCalledWith(sid('current'), 'beta', expect.any(AbortSignal))
    })
  })

  it('opens the highlighted Session with Enter and closes the palette', async () => {
    const b = mount()
    openPalette()
    const input = await screen.findByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(b.openSession).toHaveBeenCalledExactlyOnceWith(sid('current'))
    expect(screen.queryByRole('dialog', { name: '快速切换' })).toBeNull()
  })

  it('opens a Workspace or executes a command from click selection', async () => {
    const b = mount()
    openPalette()
    fireEvent.click(await screen.findByText('Alpha Workspace'))
    expect(b.openWorkspace).toHaveBeenCalledExactlyOnceWith(wid('alpha'))

    openPalette()
    fireEvent.click(await screen.findByText('/plan'))
    expect(b.runQuick).toHaveBeenCalledExactlyOnceWith(sid('current'), 'plan')
  })

  it('does not request command rows when no Session owns the main view', async () => {
    const b = mount({
      useSessions: hook(sessions([summary('other', false, { displayTitle: 'Other task' })])),
    })
    openPalette()
    await screen.findByRole('dialog', { name: '快速切换' })
    await Promise.resolve()
    expect(b.quickCommands).not.toHaveBeenCalled()
  })

  it('toggles closed with Ctrl/Cmd+K and closes with Escape', async () => {
    mount()
    openPalette()
    await screen.findByRole('dialog', { name: '快速切换' })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(screen.queryByRole('dialog', { name: '快速切换' })).toBeNull()

    openPalette()
    await screen.findByRole('dialog', { name: '快速切换' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '快速切换' })).toBeNull()
  })
})
