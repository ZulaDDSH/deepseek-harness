// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { MasterControlCenter, type MasterControlCenterProps } from '../src/client/MasterControlCenter.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function fixture(acquire?: MasterControlCenterProps['acquireMasterChat']) {
  const reference = { sessionId: 'master-control-home-test', release: vi.fn() }
  const sessions = { ids: [], byId: {}, phase: 'loading' }
  const workspaces = { items: [], archivedSessionIds: [] }
  const status = new Map()
  const binding = vi.fn()
  const props = {
    acquireMasterChat: acquire ?? vi.fn(async () => reference),
    useSessions: (select: (state: object) => unknown) => select(sessions),
    useSessionStatus: (select: (state: object) => unknown) => select(status),
    useWorkspaces: (select: (state: object) => unknown) => select(workspaces),
    discover: vi.fn(async () => ({ items: [], limited: false })),
    importChats: vi.fn(async () => ({ items: [] })),
    open: vi.fn(), interrupt: vi.fn(),
    SessionProvider: ({ session, children }: { session: unknown; children: import('react').ReactNode }) => {
      binding(session)
      return <>{children}</>
    },
    renderSlot: vi.fn(() => <textarea aria-label="Master command input" />),
    t: makeTranslate(en),
  } as unknown as MasterControlCenterProps
  return { reference, binding, props }
}

it('opens the retained master conversation beside the control-center dashboard', async () => {
  const f = fixture()
  const view = render(<MasterControlCenter {...f.props} />)
  await screen.findByRole('textbox', { name: 'Master command input' })
  expect(screen.getByRole('region', { name: 'Master conversation' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Session overview' })).toBeTruthy()
  expect(f.binding).toHaveBeenCalledWith(f.reference)
  expect(f.props.renderSlot).toHaveBeenCalledWith('main.conversation', {})
  expect(f.props.open).not.toHaveBeenCalled()
  view.unmount()
  expect(f.reference.release).toHaveBeenCalledOnce()
})

it('releases a late home acquisition after navigating away', async () => {
  let complete!: (value: unknown) => void
  const acquire = vi.fn(() => new Promise((resolve) => { complete = resolve }))
  const f = fixture(acquire as never)
  const view = render(<MasterControlCenter {...f.props} />)
  view.unmount()
  complete(f.reference)
  await vi.waitFor(() => { expect(f.reference.release).toHaveBeenCalledOnce() })
  expect(f.props.renderSlot).not.toHaveBeenCalled()
})

it('shows acquisition errors and retries without opening a workspace chat', async () => {
  const acquire = vi.fn().mockRejectedValueOnce(new Error('Host unavailable'))
  const f = fixture(acquire)
  acquire.mockResolvedValue(f.reference)
  render(<MasterControlCenter {...f.props} />)
  await screen.findByRole('alert')
  expect(screen.getByText('Error: Host unavailable')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }))
  await screen.findByRole('textbox', { name: 'Master command input' })
  expect(acquire).toHaveBeenCalledTimes(2)
  expect(f.props.open).not.toHaveBeenCalled()
})
