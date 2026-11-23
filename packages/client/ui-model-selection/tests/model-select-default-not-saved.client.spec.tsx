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
    expect(notice.textContent).toBe(zh['warning.defaultNotSaved'])
  })

  it('shows no notice when the default was saved', async () => {
    const { select } = mountSeat(false)
    chooseProModel()
    await vi.waitFor(() => { expect(select).toHaveBeenCalled() })
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('leaves a failed save from the other entry to that entry', async () => {
    const { directory } = mountSeat(false)
    await act(async () => { directory.update((s) => { s.defaultNotSaved = true }) })

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
