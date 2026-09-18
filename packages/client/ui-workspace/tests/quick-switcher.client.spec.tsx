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
    subagentsByParent: {},
    jobsBySession: {},
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
  return { items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null }
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
