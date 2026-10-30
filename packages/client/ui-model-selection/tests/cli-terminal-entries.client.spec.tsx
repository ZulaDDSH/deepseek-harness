// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { useMemo, type ComponentProps } from 'react'
import type { CliTerminalStatus } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { en, zh } from '../src/client/locales.ts'

type Translate = ComponentProps<typeof ModelSelect>['t']

function translator(dictionary: Record<string, string>): Translate {
  return (key, params) => {
    const template = dictionary[key] ?? key
    return params === undefined
      ? template
      : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
  }
}

const zhT = translator(zh)
const enT = translator(en)

function state(): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
    }],
    failures: [],
    status: 'ready',
    pending: null,
    error: null,
  }
}

const noProjection = () => undefined
const renderLabel: ComponentProps<typeof ModelSelect>['renderSlot'] = (_name, _owner, options) => options?.fallback ?? null
const resolveText: ComponentProps<typeof ModelSelect>['resolveText'] = text => typeof text === 'string' ? text : text.en

const statuses: CliTerminalStatus[] = [
  { profile: 'gemini-cli', installed: true, installUrl: 'https://geminicli.com' },
  { profile: 'grok-cli', installed: false, installUrl: 'https://x.ai/cli' },
  { profile: 'cursor-cli', installed: true, installUrl: 'https://cursor.com/cli' },
]

type SeatProps = Omit<
  ComponentProps<typeof ModelSelect>, 'useModelDirectory' | 'useModelFavorites' | 'useProjection' | 'useGlobalSetup'
> & {
  directory: SnapshotStore<ModelDirectoryState>
  favorites: SnapshotStore<string[]>
  globalSetup?: unknown
}

function Seat({ directory, favorites, globalSetup, ...props }: SeatProps) {
  const useModelDirectory = useMemo(() => bindSnapshotSelector(directory), [directory])
  const useModelFavorites = useMemo(() => bindSnapshotSelector(favorites), [favorites])
  const globalStore = useMemo(() => createSnapshotStore<unknown>(globalSetup), [globalSetup])
  const useGlobalSetup = useMemo(() => bindSnapshotSelector(globalStore), [globalStore])
  return <ModelSelect
    {...props} useProjection={noProjection} useModelDirectory={useModelDirectory}
    useModelFavorites={useModelFavorites} useGlobalSetup={useGlobalSetup}
  />
}

function renderSeat(props: Partial<SeatProps> = {}) {
  const openCliTerminal = vi.fn(async (_profile: string) => {})
  const cliProfiles = vi.fn(async (_signal: AbortSignal) => statuses)
  const seat = <Seat
    locked={false}
    favorites={createSnapshotStore<string[]>([])}
    toggleFavorite={vi.fn()}
    available
    directory={createSnapshotStore<ModelDirectoryState>(state())}
    load={vi.fn()}
    select={vi.fn(async () => ({ ok: true as const, value: undefined }))}
    openCliTerminal={openCliTerminal}
    cliProfiles={cliProfiles}
    t={zhT} renderSlot={renderLabel} resolveText={resolveText}
    {...props}
  />
  render(seat)
  if (props.available !== false) fireEvent.click(screen.getByRole('button', { name: /选择模型|Select model/u }))
  return { openCliTerminal, cliProfiles }
}

afterEach(cleanup)

describe('ModelSelect CLI terminal entries', () => {
  it('lists the installed profiles as menu items and opens the picked one', async () => {
    const { openCliTerminal, cliProfiles } = renderSeat()
    const group = await screen.findByRole('group', { name: '智能体 CLI（终端）' })
    expect(cliProfiles).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(within(group).getAllByRole('menuitem')).toHaveLength(2)
    fireEvent.click(within(group).getByRole('menuitem', { name: /^Gemini CLI/u }))
    expect(openCliTerminal).toHaveBeenCalledWith('gemini-cli')
  })

  it('shows an uninstalled profile as a muted link to its install page, not as an entry', async () => {
    renderSeat()
    const link = await screen.findByRole('link', { name: /未安装/u })
    expect(link.getAttribute('href')).toBe('https://x.ai/cli')
    expect(screen.queryByRole('menuitem', { name: /^Grok CLI/u })).toBeNull()
  })

  it.each([
    ['gemini-cli', /^Gemini CLI/u],
    ['cursor-cli', /^Cursor CLI/u],
  ])('opens the %s terminal from the English entry', async (profile, label) => {
    const { openCliTerminal } = renderSeat({ t: enT })
    fireEvent.click(await screen.findByRole('menuitem', { name: label }))
    expect(openCliTerminal).toHaveBeenCalledWith(profile)
  })

  it('renders no model seat, and so no CLI entries, for addressed subagent Sessions', () => {
    renderSeat({ available: false })
    expect(screen.queryByRole('button', { name: /选择模型|Select model/u })).toBeNull()
    expect(screen.queryByRole('group', { name: '智能体 CLI（终端）' })).toBeNull()
  })

  it('shows no CLI group when the installed-state probe fails', async () => {
    const cliProfiles = vi.fn(async (_signal: AbortSignal): Promise<CliTerminalStatus[]> => { throw new Error('offline') })
    renderSeat({ cliProfiles })
    await waitFor(() => { expect(cliProfiles).toHaveBeenCalledOnce() })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByRole('group', { name: '智能体 CLI（终端）' })).toBeNull()
  })

  it('announces a failed open through the menu toast', async () => {
    const { openCliTerminal } = renderSeat()
    openCliTerminal.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Cursor CLI/u }))
    await waitFor(() => { expect(screen.getByText(/session\/create: boom/u)).toBeTruthy() })
  })
})
