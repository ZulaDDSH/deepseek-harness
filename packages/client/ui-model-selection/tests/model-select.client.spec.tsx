// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionRunOptions, SessionRunOptionsProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { useMemo, useSyncExternalStore, type ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { en, zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

/** Renderer stand-in for useProjection: serves only runOptions from one store, absent without one. */
function projectionHook(runOptions?: SnapshotStore<SessionRunOptionsProjection | undefined>) {
  return (key: string) => useSyncExternalStore(
    listener => runOptions?.subscribe(listener) ?? (() => {}),
    () => key === 'runOptions' ? runOptions?.getSnapshot() : undefined,
  )
}
const noProjection = projectionHook()

type SeatProps = Omit<ComponentProps<typeof ModelSelect>, 'useModelDirectory' | 'useModelFavorites'> & {
  directory: SnapshotStore<ModelDirectoryState>
  favorites: SnapshotStore<string[]>
}
/** Renderer stand-in for the inject hooks compartment: binds the two stores the way the slot renderer does. */
function Seat({ directory, favorites, ...props }: SeatProps) {
  const useModelDirectory = useMemo(() => bindSnapshotSelector(directory), [directory])
  const useModelFavorites = useMemo(() => bindSnapshotSelector(favorites), [favorites])
  return <ModelSelect {...props} useModelDirectory={useModelDirectory} useModelFavorites={useModelFavorites} />
}

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        description: 'Fast catalog description',
        reasoning,
      }],
    }],
    failures: [],
    status: 'ready',
    pending: null,
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('ModelSelect reasoning effort', () => {
  it('renders effort names without descriptions and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return { ok: true as const, value: undefined }
    })
    render(<Seat
      locked={false} useProjection={noProjection}
      favorites={createSnapshotStore<string[]>([])}
      toggleFavorite={vi.fn()}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    expect(screen.getByRole('radiogroup', { name: '推理等级' })).toBeTruthy()
    expect(screen.getAllByRole('radio').map(item => item.textContent))
      .toEqual(['Off', 'High', 'Max'])
    expect(screen.queryByText('Largest budget')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: /Max/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 DeepSeek-V4-Flash，推理等级 Max')
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('offers provider default only when the adapter does not configure a model default', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    render(<Seat
      locked={false} useProjection={noProjection}
      favorites={createSnapshotStore<string[]>([])}
      toggleFavorite={vi.fn()}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    expect(screen.getAllByRole('radio').map(item => item.textContent))
      .toEqual(['Default', 'Standard'])
  })

  it('shows the durable model id when the catalog has no matching display name', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    render(<Seat
      locked={false} useProjection={noProjection}
      favorites={createSnapshotStore<string[]>([])}
      toggleFavorite={vi.fn()}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '选择模型，当前 deepseek-official/removed-model' })
    expect(trigger.textContent).toContain('removed-model')
    fireEvent.click(trigger)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByText(zh['empty.effortsUnavailable'])).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: 'removed-model' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
    expect(screen.getByText('Fast catalog description')).toBeTruthy()
  })

  it.each(['model', 'provider'])('keeps the saved id and effort when the selected %s disappears', (removed) => {
    const directory = createSnapshotStore(state({ retainedEffort: 'High' }))
    render(<Seat
      locked={false} useProjection={noProjection} favorites={createSnapshotStore<string[]>([])} toggleFavorite={vi.fn()} available
      directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
    expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent).toContain('DeepSeek-V4-Flash')
    act(() => { directory.update((snapshot) => {
      snapshot.groups = removed === 'provider' ? [] : snapshot.groups.map(group => ({ ...group, models: [] }))
      snapshot.routable = false
    }) })
    expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent)
      .toMatchInlineSnapshot('"deepseek-v4-flashHigh"')
    expect(directory.getSnapshot().current).toEqual(state().current)
  })

  it('shows loading until the catalog and Session projection are both ready', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: null,
      routable: null,
      groups: [],
      status: 'loading',
    }))
    render(<Seat
      locked={false} useProjection={noProjection}
      favorites={createSnapshotStore<string[]>([])}
      toggleFavorite={vi.fn()}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)

    expect(screen.getByRole('button', { name: '正在加载模型…' }).textContent)
      .toContain('正在加载模型…')
    directory.set(state())
    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
      })).toBeTruthy()
    })
  })

  it.each([false, true])('announces rejected selections with ownership guidance only for held writers (%s)', async (sessionInUse) => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      const error = sessionInUse
        ? new RemoteError('session/writer-held', 'writer held', { sessionId: SessionId('owned') })
        : new RemoteError('session/model-unavailable', 'session already contains images', { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
      directory.set(state({ groups, status: 'error', error: 'unrelated catalog refresh' }))
      return { ok: false as const, error }
    })
    render(<Seat
      locked={false} useProjection={noProjection}
      favorites={createSnapshotStore<string[]>([])}
      toggleFavorite={vi.fn()}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: /选择模型|当前/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(document.activeElement).toBe(trigger)
    expect(toast.textContent).toBe(sessionInUse
      ? zh['error.sessionInUse']
      : '模型操作失败：session/model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('spins on the trigger and the chosen model row until the selection settles, across menu close', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    let settle!: () => void
    const select = vi.fn((selection: ModelSelection) => {
      directory.set(state({ groups, status: 'selecting', pending: selection }))
      return new Promise<{ ok: true; value: undefined }>((resolve) => {
        settle = () => {
          directory.set(state({ groups, current: selection }))
          resolve({ ok: true, value: undefined })
        }
      })
    })
    render(<Seat
      locked={false} useProjection={noProjection} favorites={createSnapshotStore<string[]>([])} toggleFavorite={vi.fn()} available
      directory={directory} load={vi.fn()} select={select} t={t} />)
    const spinners = () => document.querySelectorAll('[data-state="ongoing"]')

    const trigger = screen.getByRole('button', { name: /选择模型|当前/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    expect(spinners()).toHaveLength(2)
    expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }).querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(trigger.querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(trigger.getAttribute('aria-busy')).toBe('true')

    // Closing the menu unmounts the row; the trigger keeps the feedback.
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('menuitemradio')).toBeNull()
    expect(spinners()).toHaveLength(1)
    expect(trigger.querySelector('[data-state="ongoing"]')).not.toBeNull()

    await act(async () => { settle() })
    expect(spinners()).toHaveLength(0)
    expect(trigger.getAttribute('aria-busy')).toBe('false')
  })

  it('spins on the chosen effort row only', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn((selection: ModelSelection) => {
      directory.set(state({ status: 'selecting', pending: selection }))
      return new Promise<undefined>(() => {})
    })
    render(<Seat
      locked={false} useProjection={noProjection} favorites={createSnapshotStore<string[]>([])} toggleFavorite={vi.fn()} available
      directory={directory} load={vi.fn()} select={select} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Max/ }))
    expect(screen.getAllByRole('radio')
      .filter(row => row.querySelector('[data-state="ongoing"]') !== null)
      .map(row => row.textContent)).toEqual(['Max'])
  })

  it('portals the placed menu card to body and closes only on truly-outside mousedown', () => {
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 200 })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 })
    try {
      const { container } = render(<Seat
        locked={false} useProjection={noProjection}
        favorites={createSnapshotStore<string[]>([])}
        toggleFavorite={vi.fn()}
        available
        directory={createSnapshotStore(state())}
        load={vi.fn()}
        select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
        t={t}
      />)
      const trigger = screen.getByRole('button', { name: /选择模型/ })
      fireEvent.click(trigger)
      const menu = screen.getByRole('menu')
      // Outside the composer subtree — column overflow clips cannot crop it.
      expect(container.contains(menu)).toBe(false)
      expect(menu.parentElement).toBe(document.body)
      // jsdom anchor rects are all zero, so the measured 200x300 card clamps
      // to the 12px viewport margin on both axes.
      expect(menu.style.left).toBe('12px')
      expect(menu.style.top).toBe('12px')
      // Interactions inside the trigger subtree or the portaled card stay open.
      expect(fireEvent.mouseDown(menu)).toBe(false)
      expect(fireEvent.mouseDown(trigger)).toBe(false)
      fireEvent.blur(trigger, { relatedTarget: menu })
      expect(screen.getByRole('menu')).toBeTruthy()
      fireEvent.mouseDown(document.body)
      expect(screen.queryByRole('menu')).toBeNull()
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth)
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
    }
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<Seat
      locked={false} useProjection={noProjection}
      favorites={createSnapshotStore<string[]>([])}
      toggleFavorite={vi.fn()}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
      select={vi.fn().mockResolvedValue(undefined)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})

describe('ModelSelect search and favorites', () => {
  it('filters the model list and moves favorited models into a top section', () => {
    const groups = [{
      id: 'provider',
      name: 'Example',
      models: [
        { id: 'flash', name: 'Flash' },
        { id: 'pro', name: 'Pro' },
      ],
    }]
    const directory = createSnapshotStore(state({ groups, current: { provider: 'provider', model: 'flash' } }))
    const favorites = createSnapshotStore<string[]>([])
    const toggleFavorite = (key: string): void => {
      favorites.update((ids) => {
        const at = ids.indexOf(key)
        if (at === -1) ids.push(key)
        else ids.splice(at, 1)
      })
    }
    render(<Seat
      locked={false} useProjection={noProjection}
      favorites={favorites}
      toggleFavorite={toggleFavorite}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    const search = screen.getByRole('searchbox', { name: '筛选模型' })
    fireEvent.change(search, { target: { value: 'pro' } })
    expect(screen.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['Pro'])
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '收藏 Pro' }))
    expect(screen.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['Pro', 'Flash'])
    expect(screen.queryByRole('group', { name: '按提供方筛选' })).toBeNull()
  })

  it('filters the model list to one provider, keeping its favorites, until the menu reopens', () => {
    const groups = [
      { id: 'deepseek-account', name: 'Account', models: [{ id: 'acct', name: 'Acct' }] },
      { id: 'anthropic', name: 'Claude', models: [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }] },
      { id: 'opencode', name: 'OpenCode', models: [{ id: 'grok', name: 'Grok' }] },
    ]
    const directory = createSnapshotStore(state({ groups, current: { provider: 'anthropic', model: 'opus' } }))
    const favorites = createSnapshotStore<string[]>(['opencode/grok'])
    render(<Seat
      locked={false} useProjection={noProjection} favorites={favorites} toggleFavorite={vi.fn()} available directory={directory}
      load={vi.fn()} select={vi.fn().mockResolvedValue({ ok: true, value: undefined })} t={t}
    />)
    const rows = () => screen.getAllByRole('menuitemradio').map(row => row.textContent)
    const chip = (name: string) => screen.getByRole('button', { name })

    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    expect(screen.getByRole('group', { name: '按提供方筛选' })).toBeTruthy()
    expect(rows()).toEqual(['Grok', 'Acct', 'Opus', 'Sonnet'])
    expect(chip('全部').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(chip('Claude'))
    expect(chip('Claude').getAttribute('aria-pressed')).toBe('true')
    expect(chip('全部').getAttribute('aria-pressed')).toBe('false')
    expect(rows()).toEqual(['Opus', 'Sonnet'])
    fireEvent.change(screen.getByRole('searchbox', { name: '筛选模型' }), { target: { value: 'son' } })
    expect(rows()).toEqual(['Sonnet'])
    fireEvent.change(screen.getByRole('searchbox', { name: '筛选模型' }), { target: { value: '' } })

    fireEvent.click(chip('OpenCode'))
    expect(rows()).toEqual(['Grok'])
    fireEvent.click(chip('DeepSeek 账号'))
    expect(rows()).toEqual(['Acct'])
    fireEvent.click(chip('全部'))
    expect(rows()).toEqual(['Grok', 'Acct', 'Opus', 'Sonnet'])

    fireEvent.click(chip('Claude'))
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    expect(screen.queryByRole('group', { name: '按提供方筛选' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    expect(rows()).toEqual(['Grok', 'Acct', 'Opus', 'Sonnet'])
  })
})

describe('ModelSelect keyboard walk', () => {
  function mountOpen() {
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    render(<Seat
      locked={false} useProjection={noProjection}
      favorites={createSnapshotStore<string[]>([])}
      toggleFavorite={vi.fn()}
      available
      directory={createSnapshotStore(state())}
      load={vi.fn()}
      select={select}
      t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    return select
  }

  it('prevents mousedown defaults inside the card without selecting a row', () => {
    const select = mountOpen()
    const row = screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })
    const max = screen.getByRole('radio', { name: 'Max' })
    expect(fireEvent.mouseDown(row.firstElementChild!)).toBe(false)
    expect(fireEvent.mouseDown(max)).toBe(false)
    fireEvent.mouseUp(screen.getByRole('menu'))
    expect(select).not.toHaveBeenCalled()
  })

  it('↑↓ walk model rows and effort levels, wrapping, and stay open', () => {
    mountOpen()
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    expect(fireEvent.keyDown(trigger, { key: 'ArrowDown' })).toBe(false)
    const model = screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })
    const levels = screen.getAllByRole('radio')
    expect(document.activeElement).toBe(model)
    fireEvent.keyDown(model, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(levels[0])
    fireEvent.keyDown(levels[0]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(model)
    fireEvent.keyDown(model, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(levels[2])
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('Tab settles the focused row like Enter and closes the menu', async () => {
    const select = mountOpen()
    const levels = screen.getAllByRole('radio')
    levels[2]!.focus()
    expect(fireEvent.keyDown(levels[2]!, { key: 'Tab' })).toBe(false)
    expect(select).toHaveBeenCalledWith({
      provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max',
    })
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  })

  it('Tab from a run-option switch closes the menu back to the trigger like Shift+Tab', async () => {
    const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: {} })
    render(<Seat
      locked={false} useProjection={projectionHook(runOptions)} favorites={createSnapshotStore<string[]>([])}
      toggleFavorite={vi.fn()} available
      directory={createSnapshotStore(state())} load={vi.fn()} select={vi.fn()}
      setRunOptions={vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))} t={t} />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    const toggle = screen.getByRole('switch', { name: 'Ultracode' })
    toggle.focus()
    expect(fireEvent.keyDown(toggle, { key: 'Tab' })).toBe(false)
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('Tab from a Claude Code effort choice closes the menu without writing it', async () => {
    const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: {} })
    const setRunOptions = vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))
    render(<Seat
      locked={false} useProjection={projectionHook(runOptions)} favorites={createSnapshotStore<string[]>([])}
      toggleFavorite={vi.fn()} available
      directory={createSnapshotStore(state())} load={vi.fn()} select={vi.fn()}
      setRunOptions={setRunOptions} t={t} />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    const max = within(screen.getByRole('radiogroup', { name: zh['runOptions.effort'] }))
      .getByRole('radio', { name: zh['runOptions.effortMax'] })
    max.focus()
    expect(fireEvent.keyDown(max, { key: 'Tab' })).toBe(false)
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    expect(setRunOptions).not.toHaveBeenCalled()
  })

  it('Shift+Tab closes back to the trigger', async () => {
    mountOpen()
    const levels = screen.getAllByRole('radio')
    levels[0]!.focus()
    expect(fireEvent.keyDown(levels[0]!, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /选择模型/ }))
    })
  })

  it('Tab with the keyboard still on the trigger enters the menu at the value in use', () => {
    render(<Seat
      locked={false} useProjection={noProjection}
      favorites={createSnapshotStore<string[]>([])}
      toggleFavorite={vi.fn()}
      available
      directory={createSnapshotStore(state())}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    expect(fireEvent.keyDown(trigger, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' }))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('a backward step from outside the list enters at the last row, and a closed menu leaves Tab native', () => {
    mountOpen()
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    expect(fireEvent.keyDown(trigger, { key: 'ArrowUp' })).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Max' }))
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(fireEvent.keyDown(trigger, { key: 'Tab' })).toBe(true)
  })

  it('keeps the card navigable when a pane has no rows, and leaves a retry its Tab', () => {
    const load = vi.fn()
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups: [], failures: [], status: 'error', error: 'catalog down',
    }))
    render(<Seat
      locked={false} useProjection={noProjection}
      favorites={createSnapshotStore<string[]>([])}
      toggleFavorite={vi.fn()}
      available
      directory={directory}
      load={load}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    // No rows to hand the keyboard to: the trigger keeps it, so the card's
    // keys still reach the menu.
    expect(document.activeElement).toBe(trigger)

    const retry = screen.getByRole('button', { name: '重试' })
    expect(fireEvent.mouseDown(retry)).toBe(false)
    fireEvent.click(retry)
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('menu')).toBeTruthy()
    retry.focus()
    // A control that is not a row keeps the browser's traversal.
    expect(fireEvent.keyDown(retry, { key: 'Tab' })).toBe(true)
    fireEvent.keyDown(retry, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Escape closes from any row and restores trigger focus', async () => {
    mountOpen()
    const levels = screen.getAllByRole('radio')
    fireEvent.keyDown(levels[0]!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /选择模型/ }))
    })
  })

  it('a pane whose rows mark no current value opens on its first row', () => {
    // The session runs a model the catalog no longer lists: no row is checked.
    render(<Seat
      locked={false} useProjection={noProjection}
      favorites={createSnapshotStore<string[]>([])}
      toggleFavorite={vi.fn()}
      available
      directory={createSnapshotStore(state({ current: { provider: 'gone', model: 'gone' } }))}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.keyDown(screen.getByRole('button', { name: /选择模型/ }), { key: 'Tab' })
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows.every(row => row.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(document.activeElement).toBe(rows[0])
  })
})

it('shows the unselected model control with the inherited effort', async () => {
  const directory = createSnapshotStore<ModelDirectoryState>(state({ current: null, routable: false, retainedEffort: 'High' }))
  render(<Seat
    locked={false} useProjection={noProjection} favorites={createSnapshotStore<string[]>([])} toggleFavorite={vi.fn()} available
    directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
  const trigger = screen.getByRole('button', { name: '请选择模型' })
  expect(trigger.hasAttribute('disabled')).toBe(false)
  await expect(`${trigger.textContent}\n`).toMatchFileSnapshot('./expected/unselected-model.txt')
  expect(trigger.textContent).toContain('High')
  fireEvent.click(trigger)
  expect(screen.queryByRole('radiogroup')).toBeNull()
  const model = screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })
  expect(document.activeElement).toBe(model)
  fireEvent.keyDown(model, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
})


it('places account and official models before third-party models', async () => {
  const groups = ['custom', 'deepseek-official', 'deepseek-account', 'another'].map(id => ({
    id, name: id, models: [1, 2].map(index => ({ id: `${id}-${index}`, name: `${id}-${index}` })),
  }))
  const directory = createSnapshotStore<ModelDirectoryState>(state({ current: null, groups }))
  render(<Seat
    locked={false} useProjection={noProjection} favorites={createSnapshotStore<string[]>([])} toggleFavorite={vi.fn()} available
    directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: '请选择模型' }))
  const names = screen.getAllByRole('menuitemradio').map(row => row.textContent)
  expect(names).toEqual([
    'deepseek-account-1', 'deepseek-account-2', 'deepseek-official-1', 'deepseek-official-2',
    'custom-1', 'custom-2', 'another-1', 'another-2',
  ])
  expect(groups.map(group => group.id)).toEqual(['custom', 'deepseek-official', 'deepseek-account', 'another'])
  await expect(`${names.join('\n')}\n`).toMatchFileSnapshot('./expected/account-first.txt')
})

it('localizes the built-in DeepSeek row descriptions', () => {
  const groups = [{ id: 'deepseek-official', name: 'DeepSeek', models: [
    { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', description: en['option.deepseekV4Flash.description'] },
  ] }]
  render(<Seat locked={false} useProjection={noProjection} favorites={createSnapshotStore<string[]>([])}
    toggleFavorite={vi.fn()} available
    directory={createSnapshotStore(state({ current: null, groups }))}
    load={vi.fn()} select={vi.fn()} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: zh['trigger.selectAria'] }))
  expect(screen.getByText(zh['option.deepseekV4Flash.description'])).toBeTruthy()
})

it.each([en, zh])('localizes the account group while preserving external names', (copy) => {
  const groups = ['deepseek-account', 'custom'].map(id => ({
    id, name: id === 'deepseek-account' ? 'DeepSeek Account' : 'My Gateway',
    models: [{ id: 'model', name: 'Model' }],
  }))
  render(<Seat locked={false} useProjection={noProjection} favorites={createSnapshotStore<string[]>([])}
    toggleFavorite={vi.fn()} available
    directory={createSnapshotStore(state({ current: null, groups }))}
    load={vi.fn()} select={vi.fn()} t={key => key in copy ? copy[key as keyof typeof copy] : key} />)
  fireEvent.click(screen.getByRole('button', { name: copy['trigger.selectAria'] }))
  expect(screen.getByRole('group', { name: copy['provider.account'] })).toBeTruthy()
  expect(screen.getByRole('group', { name: 'My Gateway' })).toBeTruthy()
})

it('restores the account model name after login without changing the saved route', () => {
  const groups = [{ id: 'deepseek-account', name: 'DeepSeek Account', models: [
    { id: 'deepseek-flash', name: 'DeepSeek Flash', reasoning },
  ] }]
  const selected = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' }
  const directory = createSnapshotStore(state({ current: selected, groups, retainedEffort: 'High' }))
  render(<Seat
    locked={false} useProjection={noProjection} favorites={createSnapshotStore<string[]>([])} toggleFavorite={vi.fn()} available
    directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
  expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent).toBe('DeepSeek FlashHigh')
  act(() => { directory.update((snapshot) => { snapshot.groups = []; snapshot.routable = false }) })
  expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent)
    .toMatchInlineSnapshot('"deepseek-flashHigh"')
  act(() => { directory.update((snapshot) => { snapshot.groups = groups; snapshot.routable = true }) })
  expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent).toBe('DeepSeek FlashHigh')
  expect(directory.getSnapshot().current).toEqual(selected)
})

it('toggles the Claude Code run options through switches', async () => {
  const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: { fastMode: true } })
  const setRunOptions = vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))
  render(<Seat
    locked={false} useProjection={projectionHook(runOptions)} favorites={createSnapshotStore<string[]>([])}
    toggleFavorite={vi.fn()} available
    directory={createSnapshotStore(state())} load={vi.fn()} select={vi.fn()}
    setRunOptions={setRunOptions} t={t} />)
  const trigger = screen.getByRole('button', { name: /选择模型，当前/ })
  expect(trigger.textContent).toContain(zh['trigger.fast'])
  expect(trigger.textContent).not.toContain(zh['trigger.ultracode'])
  expect(trigger.getAttribute('aria-label')).toBe(`选择模型，当前 DeepSeek-V4-Flash，推理等级 High，已开启：${zh['trigger.fast']}`)
  fireEvent.click(trigger)
  expect(screen.getByRole('switch', { name: '快速模式' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('switch', { name: 'Ultracode' }).getAttribute('aria-checked')).toBe('false')
  expect(screen.getByText(zh['menu.saved'])).toBeTruthy()
  fireEvent.click(screen.getByRole('switch', { name: 'Ultracode' }))
  await waitFor(() => { expect(setRunOptions).toHaveBeenCalledWith({ fastMode: true, ultracode: true }) })
})

it('announces a rejected run-option write in the toast', async () => {
  const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: {} })
  const setRunOptions = vi.fn(async () => ({
    ok: false as const,
    error: new RemoteError('session/model-unavailable', 'run options rejected', { provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
  }))
  render(<Seat
    locked={false} useProjection={projectionHook(runOptions)} favorites={createSnapshotStore<string[]>([])}
    toggleFavorite={vi.fn()} available
    directory={createSnapshotStore(state())} load={vi.fn()} select={vi.fn()}
    setRunOptions={setRunOptions} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
  fireEvent.click(screen.getByRole('switch', { name: 'Ultracode' }))
  const toast = await screen.findByRole('alert')
  expect(toast.textContent).toBe('模型操作失败：session/model-unavailable: run options rejected')
})

it('hides the Claude Code section when the Session has no runOptions projection', () => {
  render(<Seat
    locked={false} useProjection={noProjection} favorites={createSnapshotStore<string[]>([])} toggleFavorite={vi.fn()} available
    directory={createSnapshotStore(state())} load={vi.fn()} select={vi.fn()} setRunOptions={vi.fn()} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
  expect(screen.queryAllByRole('switch')).toHaveLength(0)
  expect(screen.queryByText(zh['runOptions.title'])).toBeNull()
})

it('builds a second run-option write on the first before the projection catches up', async () => {
  const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: {} })
  const setRunOptions = vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))
  render(<Seat
    locked={false} useProjection={projectionHook(runOptions)} favorites={createSnapshotStore<string[]>([])}
    toggleFavorite={vi.fn()} available
    directory={createSnapshotStore(state())} load={vi.fn()} select={vi.fn()}
    setRunOptions={setRunOptions} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
  fireEvent.click(screen.getByRole('switch', { name: '快速模式' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Ultracode' }))
  expect(screen.getByRole('switch', { name: '快速模式' }).getAttribute('aria-checked')).toBe('true')
  await waitFor(() => { expect(setRunOptions).toHaveBeenCalledTimes(2) })
  expect(setRunOptions.mock.calls).toEqual([[{ fastMode: true }], [{ fastMode: true, ultracode: true }]])
  expect(screen.getByRole('switch', { name: 'Ultracode' }).getAttribute('aria-checked')).toBe('true')
  act(() => { runOptions.set({ current: { fastMode: true, ultracode: true } }) })
  expect(screen.getByRole('switch', { name: 'Ultracode' }).getAttribute('aria-checked')).toBe('true')
})

it('sends run-option writes one at a time and voids those queued behind a rejected one', async () => {
  const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: {} })
  const first = Promise.withResolvers<RemoteResult<SessionRunOptions>>()
  const setRunOptions = vi.fn<(options: SessionRunOptions) => Promise<RemoteResult<SessionRunOptions>>>()
    .mockReturnValueOnce(first.promise)
    .mockImplementation(async options => ({ ok: true as const, value: options }))
  render(<Seat
    locked={false} useProjection={projectionHook(runOptions)} favorites={createSnapshotStore<string[]>([])}
    toggleFavorite={vi.fn()} available
    directory={createSnapshotStore(state())} load={vi.fn()} select={vi.fn()}
    setRunOptions={setRunOptions} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
  fireEvent.click(screen.getByRole('switch', { name: '快速模式' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Ultracode' }))
  await waitFor(() => { expect(setRunOptions).toHaveBeenCalledTimes(1) })
  expect(screen.getByRole('switch', { name: 'Ultracode' }).getAttribute('aria-checked')).toBe('true')
  first.resolve({ ok: false, error: new RemoteError('session/writer-held', 'held', { sessionId: SessionId('s1') }) })
  await screen.findByRole('alert')
  await waitFor(() => { expect(screen.getByRole('switch', { name: 'Ultracode' }).getAttribute('aria-checked')).toBe('false') })
  expect(screen.getByRole('switch', { name: '快速模式' }).getAttribute('aria-checked')).toBe('false')
  fireEvent.click(screen.getByRole('switch', { name: 'Ultracode' }))
  await waitFor(() => { expect(setRunOptions).toHaveBeenCalledTimes(2) })
  expect(setRunOptions.mock.calls).toEqual([[{ fastMode: true }], [{ ultracode: true }]])
})

it('writes the Claude Code effort with the other run options and clears it with Default', async () => {
  const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: { fastMode: true } })
  const setRunOptions = vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))
  render(<Seat
    locked={false} useProjection={projectionHook(runOptions)} favorites={createSnapshotStore<string[]>([])}
    toggleFavorite={vi.fn()} available
    directory={createSnapshotStore(state())} load={vi.fn()} select={vi.fn()}
    setRunOptions={setRunOptions} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
  const group = screen.getByRole('radiogroup', { name: zh['runOptions.effort'] })
  expect(within(group).getByRole('radio', { name: zh['runOptions.effortDefault'] }).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(within(group).getByRole('radio', { name: zh['runOptions.effortMax'] }))
  await waitFor(() => { expect(setRunOptions).toHaveBeenCalledWith({ fastMode: true, effort: 'max' }) })
  act(() => { runOptions.set({ current: { fastMode: true, effort: 'max' } }) })
  fireEvent.click(within(group).getByRole('radio', { name: zh['runOptions.effortDefault'] }))
  await waitFor(() => { expect(setRunOptions).toHaveBeenLastCalledWith({ fastMode: true, effort: undefined }) })
})

it('names an unlisted selection by its last advertised catalog name', () => {
  const directory = createSnapshotStore(state({
    current: { provider: 'anthropic', model: 'claude-opus-5-5' },
    retainedName: 'Claude Opus 5.5',
  }))
  render(<Seat
    locked={false} useProjection={noProjection} favorites={createSnapshotStore<string[]>([])} toggleFavorite={vi.fn()} available
    directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
  expect(screen.getByRole('button', { name: '选择模型，当前 Claude Opus 5.5' }).textContent).toBe('Claude Opus 5.5')
})

it('shows the bare model id on the trigger and the provider/model in its title when no name is known', () => {
  const directory = createSnapshotStore(state({ current: { provider: 'anthropic', model: 'claude-opus-5-5' } }))
  render(<Seat
    locked={false} useProjection={noProjection} favorites={createSnapshotStore<string[]>([])} toggleFavorite={vi.fn()} available
    directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
  const trigger = screen.getByRole('button', { name: '选择模型，当前 anthropic/claude-opus-5-5' })
  expect(trigger.textContent).toBe('claude-opus-5-5')
  expect(trigger.getAttribute('title')).toBe('anthropic/claude-opus-5-5')
})

it('pins an unlisted selection as a disabled checked row under the current session', () => {
  const directory = createSnapshotStore(state({
    current: { provider: 'anthropic', model: 'claude-opus-5-5' },
    routable: false,
    retainedName: 'Claude Opus 5.5',
  }))
  render(<Seat
    locked={false} useProjection={noProjection} favorites={createSnapshotStore<string[]>([])} toggleFavorite={vi.fn()} available
    directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: '选择模型，当前 Claude Opus 5.5，不可用' }))
  const row = screen.getByRole('menuitemradio', { name: 'Claude Opus 5.5' })
  expect(row.getAttribute('aria-checked')).toBe('true')
  expect(row.hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('group', { name: zh['current.title'] }).contains(row)).toBe(true)
  expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' }).getAttribute('aria-checked')).toBe('false')
})
