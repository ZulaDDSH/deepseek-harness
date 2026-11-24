// @vitest-environment jsdom (constraint: the component needs a DOM)
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { useMemo, useSyncExternalStore, type ComponentProps } from 'react'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { zh } from '../src/client/locales.ts'

const t: ComponentProps<typeof ModelSelect>['t'] = key => (zh as Record<string, string>)[key] ?? key
const renderLabel: ComponentProps<typeof ModelSelect>['renderSlot'] = (_name, _owner, options) => options?.fallback ?? null
const resolveText: ComponentProps<typeof ModelSelect>['resolveText'] = text => typeof text === 'string' ? text : text.en
const noProjection = () => useSyncExternalStore(() => () => {}, () => undefined)

const initial: ModelDirectoryState = {
  current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  routable: true,
  groups: [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
    ],
  }],
  failures: [],
  status: 'ready',
  pending: null,
  error: null,
}

function Seat({ directory, select }: {
  directory: ReturnType<typeof createSnapshotStore<ModelDirectoryState>>
  select: ComponentProps<typeof ModelSelect>['select']
}) {
  const useModelDirectory = useMemo(() => bindSnapshotSelector(directory), [directory])
  const useModelFavorites = useMemo(() => bindSnapshotSelector(createSnapshotStore<string[]>([])), [])
  return <ModelSelect
    locked={false} available useProjection={noProjection as never}
    useModelDirectory={useModelDirectory} useModelFavorites={useModelFavorites}
    toggleFavorite={vi.fn()} cliProfiles={vi.fn(async () => [])} openCliTerminal={vi.fn(async () => {})}
    renderSlot={renderLabel} resolveText={resolveText} load={vi.fn()} select={select} t={t}
  />
}

function mountSeat(defaultNotSaved: boolean) {
  const directory = createSnapshotStore<ModelDirectoryState>(initial)
  const select = vi.fn(async (selection: ModelSelection) => {
    directory.update((s) => { s.status = 'selecting'; s.pending = selection })
    await Promise.resolve()
    directory.update((s) => {
      s.status = 'ready'; s.pending = null; s.current = selection
      if (defaultNotSaved) s.defaultNotSaved = true
    })
    return { ok: true as const, value: undefined }
  })
  render(<Seat directory={directory} select={select} />)
  return { directory, select }
}

function chooseProModel(): void {
  fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() })
  onTestFinished(() => { Reflect.deleteProperty(Element.prototype, 'scrollIntoView') })
})

afterEach(cleanup)

describe('ModelSelect default-not-saved notice', () => {
  it('shows a non-blocking notice after the seat switches a model whose default was not saved', async () => {
    mountSeat(true)
    chooseProModel()

    const notice = await screen.findByRole('alert')
    expect(notice.textContent).toContain(zh['warning.defaultNotSaved'])
  })

  it('shows no notice when the default was saved', async () => {
    const { select } = mountSeat(false)
    chooseProModel()
    await vi.waitFor(() => { expect(select).toHaveBeenCalled() })
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('retries the default save from the notice and clears the notice once the save succeeds', async () => {
    let saves = 0
    const directory = createSnapshotStore<ModelDirectoryState>(initial)
    const select = vi.fn(async (selection: ModelSelection) => {
      saves += 1
      directory.update((s) => { s.status = 'selecting'; s.pending = selection; delete s.defaultNotSaved })
      await Promise.resolve()
      directory.update((s) => {
        s.status = 'ready'; s.pending = null; s.current = selection
        if (saves === 1) s.defaultNotSaved = true
      })
      return { ok: true as const, value: undefined }
    })
    render(<Seat directory={directory} select={select} />)
    chooseProModel()

    fireEvent.click(await screen.findByRole('button', { name: zh['warning.defaultRetry'] }))
    await vi.waitFor(() => { expect(select).toHaveBeenCalledTimes(2) })
    expect(select.mock.calls[1]?.[0]).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('retries the selection current at click time, not the one that raised the notice', async () => {
    const { directory, select } = mountSeat(true)
    chooseProModel()
    const retry = await screen.findByRole('button', { name: zh['warning.defaultRetry'] })
    await act(async () => {
      directory.update((s) => { s.current = { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    })
    fireEvent.click(retry)

    await vi.waitFor(() => { expect(select).toHaveBeenCalledTimes(2) })
    expect(select.mock.calls[1]?.[0]).toMatchObject({ model: 'deepseek-v4-flash' })
  })

  it('dismisses a pending notice when another selection is submitted', async () => {
    mountSeat(true)
    chooseProModel()
    await screen.findByRole('alert')

    fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Flash/ }))

    await vi.waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  })

  it('shows a saving notice without a retry for a stalled save, then a saved notice on its late success', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(initial)
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.update((s) => { s.status = 'selecting'; s.pending = selection })
      await Promise.resolve()
      directory.update((s) => { s.status = 'ready'; s.pending = null; s.current = selection; s.defaultLate = 'saving' })
      return { ok: true as const, value: undefined }
    })
    render(<Seat directory={directory} select={select} />)
    chooseProModel()

    expect((await screen.findByRole('alert')).textContent).toContain(zh['warning.defaultSaving'])
    expect(screen.queryByRole('button', { name: zh['warning.defaultRetry'] })).toBeNull()
    await act(async () => { directory.update((s) => { s.defaultLate = 'saved' }) })
    await vi.waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(zh['warning.defaultSaved']) })
    expect(screen.queryByRole('button', { name: zh['warning.defaultRetry'] })).toBeNull()
  })

  it('shows the retry notice when a stalled save later fails', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(initial)
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.update((s) => { s.status = 'selecting'; s.pending = selection })
      await Promise.resolve()
      directory.update((s) => { s.status = 'ready'; s.pending = null; s.current = selection; s.defaultLate = 'saving' })
      return { ok: true as const, value: undefined }
    })
    render(<Seat directory={directory} select={select} />)
    chooseProModel()
    await screen.findByText(zh['warning.defaultSaving'])

    await act(async () => { directory.update((s) => { delete s.defaultLate; s.defaultNotSaved = true }) })
    await screen.findByRole('button', { name: zh['warning.defaultRetry'] })
    expect(screen.getByRole('alert').textContent).toContain(zh['warning.defaultNotSaved'])
  })

  it('leaves a failed save from the other entry to that entry', async () => {
    const { directory } = mountSeat(false)
    await act(async () => { directory.update((s) => { s.defaultNotSaved = true }) })

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
