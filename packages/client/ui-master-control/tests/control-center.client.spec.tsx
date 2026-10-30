// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { MasterControlCenter } from '../src/client/MasterControlCenter.tsx'
import type { MasterControlPageProps } from '../src/client/MasterControlPage.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function fixture(openMasterChat?: MasterControlPageProps['openMasterChat']) {
  const sessions = { ids: [], byId: {}, phase: 'loading' }
  const workspaces = { items: [], archivedSessionIds: [] }
  const status = new Map()
  const props = {
    openMasterChat: openMasterChat ?? vi.fn(async () => {}),
    useSessions: (select: (state: object) => unknown) => select(sessions),
    useSessionStatus: (select: (state: object) => unknown) => select(status),
    useWorkspaces: (select: (state: object) => unknown) => select(workspaces),
    discover: vi.fn(async () => ({ items: [], limited: false })),
    importChats: vi.fn(async () => ({ items: [] })),
    open: vi.fn(), interrupt: vi.fn(),
    t: makeTranslate(en),
  } as unknown as MasterControlPageProps
  return { props }
}

it('shows the master pane beside the control-center dashboard and opens the master chat on request', async () => {
  const f = fixture()
  render(<MasterControlCenter {...f.props} />)
  expect(screen.getByRole('region', { name: 'Master conversation' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Session overview' })).toBeTruthy()
  expect(f.props.openMasterChat).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Open master chat' }))
  expect(f.props.openMasterChat).toHaveBeenCalledOnce()
})

it('shows an open failure and lets the user try again', async () => {
  const openMasterChat = vi.fn().mockRejectedValueOnce(new Error('Host unavailable')).mockResolvedValue(undefined)
  const f = fixture(openMasterChat)
  render(<MasterControlCenter {...f.props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open master chat' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Error: Host unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Open master chat' }))
  await vi.waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  expect(openMasterChat).toHaveBeenCalledTimes(2)
})
