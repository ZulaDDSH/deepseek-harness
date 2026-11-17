// @vitest-environment jsdom
import * as uiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { bindSnapshotSelector, RemoteError, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionRunOptions, SessionRunOptionsProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { useMemo, useSyncExternalStore, type ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect as ModelSelectView } from '../src/client/ModelSelect.tsx'
import { en, zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

type ViewProps = ComponentProps<typeof ModelSelectView>
type UseProjection = ViewProps['useProjection']

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ViewProps['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const renderLabel: ViewProps['renderSlot'] = (_name, _owner, options) => options?.fallback ?? null

const resolveText: ViewProps['resolveText'] = text => typeof text === 'string' ? text : text.en

/** Renderer stand-in for useProjection: serves runOptions from one store and the Claude Code capability, absent without the store. */
function projectionHook(runOptions?: SnapshotStore<SessionRunOptionsProjection | undefined>): UseProjection {
  return ((key: string) => useSyncExternalStore(
    listener => runOptions?.subscribe(listener) ?? (() => {}),
    () => key === 'runOptions' ? runOptions?.getSnapshot() : key === 'claudeCodeRunOptions' && runOptions !== undefined ? true : undefined,
  ))
}
const noProjection = projectionHook()
const cliStubs = { cliProfiles: vi.fn(async () => []), openCliTerminal: vi.fn(async () => {}) }
const toggleStub = vi.fn()

type SeatProps = Omit<ViewProps, 'useModelDirectory' | 'useModelFavorites' | 'useGlobalSetup' | 'useProjection' | 'toggleFavorite' | 'cliProfiles' | 'openCliTerminal' | 'renderSlot'>
  & Partial<Pick<ViewProps, 'useProjection' | 'toggleFavorite' | 'cliProfiles' | 'openCliTerminal' | 'renderSlot'>>
  & { directory: SnapshotStore<ModelDirectoryState>; favorites?: SnapshotStore<string[]>; globalSetup?: unknown }

/** Renderer stand-in for the inject hooks compartment: binds the stores the way the slot renderer does. */
function ModelSelect({
  directory, favorites, globalSetup, useProjection = noProjection, toggleFavorite = toggleStub, cliProfiles = cliStubs.cliProfiles,
  openCliTerminal = cliStubs.openCliTerminal, renderSlot = renderLabel, ...props
}: SeatProps) {
  const useModelDirectory = useMemo(() => bindSnapshotSelector(directory), [directory])
  const favoriteStore = useMemo(() => favorites ?? createSnapshotStore<string[]>([]), [favorites])
  const useModelFavorites = useMemo(() => bindSnapshotSelector(favoriteStore), [favoriteStore])
  const globalStore = useMemo(() => createSnapshotStore<unknown>(globalSetup), [globalSetup])
  const useGlobalSetup = useMemo(() => bindSnapshotSelector(globalStore), [globalStore])
  return <ModelSelectView
    {...props}
    useModelDirectory={useModelDirectory}
    useModelFavorites={useModelFavorites}
    useGlobalSetup={useGlobalSetup}
    useProjection={useProjection}
    toggleFavorite={toggleFavorite}
    cliProfiles={cliProfiles}
    openCliTerminal={openCliTerminal}
    renderSlot={renderSlot}
  />
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

function capableState(): ModelDirectoryState {
  return state({
    current: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    groups: [{
      id: 'anthropic',
      name: 'Anthropic',
      models: [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', reasoning, ultracode: true }],
    }],
  })
}

function modelGroups(count: number): ModelDirectoryState['groups'] {
  const group = state().groups[0]!
  return [{ ...group, models: [
    ...group.models,
    ...Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({
      id: `model-${index + 2}`, name: `Model ${index + 2}`,
    })),
  ].slice(0, count) }]
}

const scrollIntoView = vi.fn()
beforeEach(() => {
  scrollIntoView.mockClear()
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView })
  onTestFinished(() => {
    if (descriptor === undefined) Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    else Object.defineProperty(Element.prototype, 'scrollIntoView', descriptor)
  })
})

afterEach(cleanup)

describe('ModelSelect label slot', () => {
  it('distinguishes identical model names and ids by provider across all placements and restores labels on unload', async () => {
    const runtime = await SlotTestRuntime.create()
    onTestFinished(() => runtime.dispose())
    const sessionId = SessionId('model-label')
    await runtime.sessions.add({ id: sessionId })
    const session = runtime.sessions.retainFor(runtime.ctx, sessionId)
    const groups = ['trusted', 'external'].map(id => ({
      id, name: `${id} gateway`, models: [{ id: 'same-model', name: 'Same model' }],
    }))
    const directory = createSnapshotStore(state({ groups, current: { provider: 'trusted', model: 'same-model' } }))
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.update((snapshot) => { snapshot.current = selection })
      return { ok: true as const, value: undefined }
    })
    await runtime.root.declare({
      'conversation.input.model.label': { kind: 'single', scope: 'session', inline: true },
    }, ({ renderSlot, SessionProvider }) => <SessionProvider session={session}>
      <ModelSelect locked={false} available directory={directory} load={vi.fn()}
        resolveText={resolveText} select={select} t={t} renderSlot={renderSlot} />
    </SessionProvider>)
    runtime.renderRoot()
    const trigger = screen.getByRole('button', { name: '选择模型，当前 Same model' })
    expect(trigger.textContent).toBe('Same model')
    const plugin = await runtime.mount({ inject: ['slots'], apply(ctx) {
      ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register({
        name: 'conversation.input.model.label',
      }, ({ provider, model, placement, selected }) => <span
        data-testid={`${placement}-${provider.id}`}
        data-selected={selected}
        title={provider.name}
      >{provider.id}: {model.name}</span>))
    } })
    expect(screen.getByTestId('trigger-trusted').textContent).toBe('trusted: Same model')
    expect(screen.getByTestId('trigger-trusted').title).toBe('trusted gateway')
    expect(trigger.querySelector('div')).toBeNull()
    fireEvent.click(trigger)
    expect(screen.getByTestId('menu-trusted').textContent).toBe('trusted: Same model')
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    expect(screen.getByTestId('option-trusted').getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId('option-external').getAttribute('data-selected')).toBe('false')
    const external = screen.getByRole('menuitemradio', { name: 'external: Same model' })
    expect(external.querySelector('[data-provider-id="external"][data-model-id="same-model"]')).toBeTruthy()
    expect(external.querySelector('div')).toBeNull()
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'trusted: Same model' }), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(external)
    fireEvent.keyDown(external, { key: 'Tab' })
    await waitFor(() => { expect(screen.getByTestId('trigger-external')).toBeTruthy() })
    expect(select).toHaveBeenCalledWith({ provider: 'external', model: 'same-model' })
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    await act(async () => { await plugin.dispose() })
    expect(runtime.slots.entries('conversation.input.model.label')).toHaveLength(0)
    expect(trigger.textContent).toBe('Same model')
    expect(trigger.querySelector('[data-provider-id="external"][data-model-id="same-model"]')).toBeTruthy()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    expect(screen.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['Same model', 'Same model'])
  })

  it('does not decorate loading or missing selections with a stale provider', () => {
    const directory = createSnapshotStore(state({ groups: [], status: 'loading' }))
    const renderSlot = vi.fn(() => null)
    render(<ModelSelect locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={vi.fn()} t={t} renderSlot={renderSlot} />)
    expect(renderSlot).not.toHaveBeenCalled()
    expect(document.querySelector('[data-provider-id]')).toBeNull()
    act(() => { directory.set(state({ groups: [] })) })
    expect(screen.getByRole('button', { name: '选择模型，当前 deepseek-official/deepseek-v4-flash' })).toBeTruthy()
    expect(renderSlot).not.toHaveBeenCalled()
  })
})

describe('ModelSelect catalog badges', () => {
  const BADGE = { text: { en: 'New', zh: '新' }, tone: 'info' } as const
  const badged = () => state({
    current: { provider: 'deepseek-official', model: 'deepseek-flash' },
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', badge: BADGE },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }],
  })
  const chinese: ViewProps['resolveText'] = text => typeof text === 'string' ? text : text.zh ?? text.en

  it('places the badge before the trigger name and after names in the menus', () => {
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(badged())}
      load={vi.fn()} resolveText={chinese} select={vi.fn()} t={t} />)
    const trigger = screen.getByRole('button', { name: '选择模型，当前 DeepSeek-V4.1-Flash' })
    expect(trigger.textContent).toBe('新 DeepSeek-V4.1-Flash')
    expect(screen.getByText('新').getAttribute('data-tone')).toBe('info')
    fireEvent.click(trigger)
    const current = screen.getByRole('menuitem', { name: /^模型/ })
    expect(current.textContent).toContain('DeepSeek-V4.1-Flash 新')
    fireEvent.click(current)
    expect(screen.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['DeepSeek-V4.1-Flash 新', 'DeepSeek-V4-Pro'])
  })

  it('hands the badge to a label contribution, which replaces the default rendering', async () => {
    const runtime = await SlotTestRuntime.create()
    onTestFinished(() => runtime.dispose())
    const sessionId = SessionId('model-badge')
    await runtime.sessions.add({ id: sessionId })
    const session = runtime.sessions.retainFor(runtime.ctx, sessionId)
    await runtime.root.declare({
      'conversation.input.model.label': { kind: 'single', scope: 'session', inline: true },
    }, ({ renderSlot, SessionProvider }) => <SessionProvider session={session}>
      <ModelSelect locked={false} available directory={createSnapshotStore(badged())} load={vi.fn()} resolveText={chinese}
        select={vi.fn()} t={t} renderSlot={renderSlot} />
    </SessionProvider>)
    runtime.renderRoot()
    await runtime.mount({ inject: ['slots'], apply(ctx) {
      ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register({
        name: 'conversation.input.model.label',
      }, ({ model }) => <span>{model.name} [{model.badge?.tone ?? 'none'}]</span>))
    } })
    expect(screen.getByRole('button', { name: '选择模型，当前 DeepSeek-V4.1-Flash' }).textContent).toBe('DeepSeek-V4.1-Flash [info]')
    expect(screen.queryByText('新')).toBeNull()
  })
})

describe('ModelSelect reasoning effort', () => {
  it('renders effort names without descriptions and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return { ok: true as const, value: undefined }
    })
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={directory}
      load={vi.fn()} resolveText={resolveText}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Off', 'High', 'Max'])
    expect(screen.queryByText('Largest budget')).toBeNull()

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
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
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={directory}
      load={vi.fn()} resolveText={resolveText}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Default', 'Standard'])
  })

  it('pins a saved route absent from the catalog as a disabled checked row under the current session', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
      routable: false,
    }))
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={select} t={t} />)

    const trigger = screen.getByRole('button', { name: '选择模型，当前 deepseek-official/removed-model，不可用' })
    expect(trigger.textContent).toBe('removed-model')
    expect(trigger.getAttribute('title')).toBe(`deepseek-official/removed-model — ${zh['trigger.unavailableModelHint']}`)
    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitem', { name: /推理等级/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /模型/ })).toBeNull()
    const pinned = screen.getByRole('menuitemradio', { name: 'removed-model' })
    expect(pinned.getAttribute('aria-checked')).toBe('true')
    expect(pinned.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('group', { name: zh['current.title'] }).contains(pinned)).toBe(true)
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
    expect(select).not.toHaveBeenCalled()
    expect(directory.getSnapshot().current).toEqual({ provider: 'deepseek-official', model: 'removed-model' })
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' }), { key: 'Escape' })
    expect(screen.queryByRole('group', { name: '模型与推理等级' })).toBeNull()
  })

  it.each(['model', 'provider'])('keeps the saved id and effort when the selected %s disappears', (removed) => {
    const directory = createSnapshotStore(state({ retainedEffort: 'High' }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={vi.fn()} t={t} />)
    expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent).toContain('DeepSeek-V4-Flash')
    act(() => { directory.update((snapshot) => {
      snapshot.groups = removed === 'provider' ? [] : snapshot.groups.map(group => ({ ...group, models: [] }))
      snapshot.routable = false
    }) })
    const trigger = screen.getByRole('button', { name: /选择模型，当前/ })
    expect(trigger.textContent).toBe('deepseek-v4-flashHigh')
    expect(directory.getSnapshot().current).toEqual(state().current)
    fireEvent.click(trigger)
    expect(screen.getByRole('status').textContent).toBe(zh['empty.models'])
    fireEvent.keyDown(trigger, { key: 'Tab', shiftKey: true })
    expect(screen.queryByRole('group', { name: '模型与推理等级' })).toBeNull()
  })

  it.each([null, state().current])('shows loading until the catalog and Session projection are both ready (%j)', async (current) => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current,
      routable: null,
      groups: [],
      status: 'loading',
    }))
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={directory}
      load={vi.fn()} resolveText={resolveText}
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
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={directory}
      load={vi.fn()} resolveText={resolveText}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: /选择模型|当前/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    const rejected = screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ })
    fireEvent.mouseMove(rejected)
    fireEvent.click(rejected)
    const toast = await screen.findByRole('alert')
    expect(document.activeElement).toBe(trigger)
    expect(toast.textContent).toBe(sessionInUse
      ? zh['error.sessionInUse']
      : '模型操作失败：session/model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
    fireEvent.keyDown(trigger, { key: 'Tab' })
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' }))
  })

  it('spins on the trigger and the chosen model row until the selection settles, across pane changes', async () => {
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
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={select} t={t} />)
    const spinners = () => document.querySelectorAll('[data-state="ongoing"]')

    const trigger = screen.getByRole('button', { name: /选择模型|当前/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    expect(spinners()).toHaveLength(2)
    expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }).querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(trigger.querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(trigger.getAttribute('aria-busy')).toBe('true')

    // Leaving the pane unmounts the row; the trigger keeps the feedback.
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
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={select} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
    expect(screen.getAllByRole('menuitemradio')
      .filter(row => row.querySelector('[data-state="ongoing"]') !== null)
      .map(row => row.textContent)).toEqual(['Max'])
  })

  it('portals the placed menu card to body and closes only on truly-outside mousedown', () => {
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 200 })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 })
    try {
      const { container } = render(<ModelSelect renderSlot={renderLabel}
        locked={false}
        available
        directory={createSnapshotStore(state())}
        load={vi.fn()} resolveText={resolveText}
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
      expect(fireEvent.mouseDown(menu)).toBe(true)
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
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load} resolveText={resolveText}
      select={vi.fn().mockResolvedValue(undefined)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})

describe('ModelSelect favorites and provider filter', () => {
  it('moves favorited models into a top section and keeps them listed there', () => {
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
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={vi.fn().mockResolvedValue({ ok: true, value: undefined })} t={t}
      favorites={favorites} toggleFavorite={toggleFavorite} />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    expect(screen.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['Flash', 'Pro'])
    expect(screen.queryByRole('group', { name: zh['filter.aria'] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '收藏 Pro' }))
    expect(screen.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['Pro', 'Flash'])
    expect(within(screen.getByRole('group', { name: zh['favorites.title'] })).getByRole('menuitemradio', { name: 'Pro' })).toBeTruthy()
  })

  it('filters the model list to one provider, keeping its favorites, until the menu reopens', () => {
    const groups = [
      { id: 'deepseek-account', name: 'Account', models: [{ id: 'acct', name: 'Acct' }] },
      { id: 'anthropic', name: 'Claude', models: [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }] },
      { id: 'opencode', name: 'OpenCode', models: [{ id: 'grok', name: 'Grok' }] },
    ]
    const directory = createSnapshotStore(state({ groups, current: { provider: 'anthropic', model: 'opus' } }))
    const favorites = createSnapshotStore<string[]>(['opencode/grok'])
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={vi.fn().mockResolvedValue({ ok: true, value: undefined })} t={t}
      favorites={favorites} toggleFavorite={vi.fn()} />)
    const rows = () => screen.getAllByRole('menuitemradio').map(row => row.textContent)
    const chip = (name: string) => screen.getByRole('button', { name })

    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    expect(screen.getByRole('group', { name: zh['filter.aria'] })).toBeTruthy()
    expect(rows()).toEqual(['Grok', 'Acct', 'Opus', 'Sonnet'])
    expect(chip(zh['filter.all']).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(chip('Claude'))
    expect(chip('Claude').getAttribute('aria-pressed')).toBe('true')
    expect(chip(zh['filter.all']).getAttribute('aria-pressed')).toBe('false')
    expect(rows()).toEqual(['Opus', 'Sonnet'])

    fireEvent.click(chip('OpenCode'))
    expect(rows()).toEqual(['Grok'])
    fireEvent.click(chip(zh['provider.account']))
    expect(rows()).toEqual(['Acct'])
    fireEvent.click(chip(zh['filter.all']))
    expect(rows()).toEqual(['Grok', 'Acct', 'Opus', 'Sonnet'])

    fireEvent.click(chip('Claude'))
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    expect(screen.queryByRole('group', { name: zh['filter.aria'] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    expect(rows()).toEqual(['Grok', 'Acct', 'Opus', 'Sonnet'])
  })
})

describe('ModelSelect keyboard walk', () => {
  function mountOpen() {
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={createSnapshotStore(state())}
      load={vi.fn()} resolveText={resolveText}
      select={select}
      t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    return select
  }

  it.each([
    { device: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 },
    { device: 'desktop-mode iPad', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 },
  ].flatMap(device => [1, 5].map(modelCount => ({ ...device, modelCount }))))(
    'retains menu keyboard focus on $device with $modelCount models without automatically focusing search',
    async ({ userAgent, platform, maxTouchPoints, modelCount }) => {
      for (const [name, value] of Object.entries({ userAgent, platform, maxTouchPoints })) {
        const descriptor = Object.getOwnPropertyDescriptor(navigator, name)
        Object.defineProperty(navigator, name, { configurable: true, value })
        onTestFinished(() => {
          if (descriptor === undefined) Reflect.deleteProperty(navigator, name)
          else Object.defineProperty(navigator, name, descriptor)
        })
      }
      vi.resetModules()
      const detection = await import('@deepseek-ai/dsh-client-ui-primitives/src/focus.ts')
      const device = vi.spyOn(uiPrimitives, 'isMobileDevice').mockImplementation(detection.isMobileDevice)
      onTestFinished(() => { device.mockRestore() })
      const select = vi.fn()
      render(<ModelSelect renderSlot={renderLabel} locked={false} available
        directory={createSnapshotStore(state({ groups: modelGroups(modelCount) }))}
        load={vi.fn()} resolveText={resolveText} select={select} t={t}
      />)
      const trigger = screen.getByRole('button', { name: /选择模型/ })
      fireEvent.click(trigger)
      expect(document.activeElement).toBe(trigger)

      const modelCell = screen.getByRole('menuitem', { name: /^模型/ })
      const effortCell = screen.getByRole('menuitem', { name: /推理等级/ })
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      fireEvent.keyDown(modelCell, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(effortCell)
      fireEvent.keyDown(effortCell, { key: 'Tab' })
      const high = screen.getByRole('menuitemradio', { name: 'High' })
      const max = screen.getByRole('menuitemradio', { name: /Max/ })
      expect(document.activeElement).toBe(high)
      fireEvent.keyDown(high, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(max)
      fireEvent.keyDown(max, { key: 'Escape' })

      const restoredEffortCell = screen.getByRole('menuitem', { name: /推理等级/ })
      expect(document.activeElement).toBe(restoredEffortCell)
      fireEvent.keyDown(restoredEffortCell, { key: 'ArrowUp' })
      const restoredModelCell = screen.getByRole('menuitem', { name: /^模型/ })
      expect(document.activeElement).toBe(restoredModelCell)
      fireEvent.keyDown(restoredModelCell, { key: 'Tab' })
      const model = screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })
      expect(document.activeElement).toBe(model)
      if (modelCount > 4) {
        const search = screen.getByRole('searchbox')
        expect(document.activeElement).not.toBe(search)
        fireEvent.keyDown(model, { key: 'ArrowDown' })
        expect(document.activeElement).toBe(search)
      } else {
        expect(screen.queryByRole('searchbox')).toBeNull()
      }
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^模型/ }))
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
      await waitFor(() => { expect(document.activeElement).toBe(trigger) })
      expect(select).not.toHaveBeenCalled()
    },
  )

  it.each(['model', 'effort'])('prevents button mousedown defaults in the %s pane without selecting it', (pane) => {
    const select = mountOpen()
    const cell = screen.getByRole('menuitem', { name: pane === 'model' ? /^模型/ : /推理等级/ })
    expect(fireEvent.mouseDown(cell.firstElementChild!)).toBe(false)
    fireEvent.click(cell)
    const rows = screen.getAllByRole('menuitemradio')
    const focused = document.activeElement
    expect(fireEvent.mouseDown(rows[0]!.firstElementChild!)).toBe(false)
    fireEvent.mouseUp(screen.getByRole('menu'))
    expect(select).not.toHaveBeenCalled()
    fireEvent.keyDown(focused!, { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: pane === 'model' ? /^模型/ : /推理等级/ }))
  })

  it('↑↓ walk the rows of the shown pane, wrapping, and stay open', () => {
    mountOpen()
    // The trigger holds focus while the menu opens: the first forward step
    // enters at the first cell instead of skipping it. false = preventDefault ran.
    const cells = screen.getAllByRole('menuitem')
    expect(fireEvent.keyDown(cells[0]!, { key: 'ArrowDown' })).toBe(false)
    expect(document.activeElement).toBe(cells[0])

    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows.map(row => row.textContent)).toEqual(['Off', 'High', 'Max'])
    // The pane opens on its checked row, so walking starts from High.
    fireEvent.keyDown(rows[1]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[2])
    fireEvent.keyDown(rows[2]!, { key: 'ArrowDown' }) // wraps to the top
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0]!, { key: 'ArrowUp' }) // wraps to the bottom
    expect(document.activeElement).toBe(rows[2])
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('Tab settles the focused row like Enter and closes the menu', async () => {
    const select = mountOpen()
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const rows = screen.getAllByRole('menuitemradio')
    fireEvent.keyDown(rows[1]!, { key: 'ArrowDown' }) // High → Max
    expect(fireEvent.keyDown(rows[2]!, { key: 'Tab' })).toBe(false)
    expect(select).toHaveBeenCalledWith({
      provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max',
    })
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  })

  it('Shift+Tab leaves a drilled pane and then closes, like Escape', () => {
    mountOpen()
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const rows = screen.getAllByRole('menuitemradio')
    expect(fireEvent.keyDown(rows[0]!, { key: 'Tab', shiftKey: true })).toBe(false)
    // Back on the drilled cell, then closed on the second press.
    const cells = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(cells[1])
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(cells[1]!, { key: 'Tab', shiftKey: true })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Tab with the keyboard still on the trigger enters the menu at the value in use', () => {
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={createSnapshotStore(state())}
      load={vi.fn()} resolveText={resolveText}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    expect(fireEvent.keyDown(trigger, { key: 'Tab' })).toBe(false)
    // The root pane's first cell carries the current selection.
    const cells = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(cells[0])
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('a backward step from outside the list enters at the last row, and a closed menu leaves Tab native', () => {
    mountOpen()
    const [modelRow, effortRow] = screen.getAllByRole('menuitem')
    expect(fireEvent.keyDown(modelRow!, { key: 'ArrowUp' })).toBe(false)
    expect(document.activeElement).toBe(effortRow)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(fireEvent.keyDown(trigger, { key: 'Tab' })).toBe(true)
  })

  it('hands a drilled pane the focus its unmounted cell left behind, on the value in use', () => {
    mountOpen()
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const rows = screen.getAllByRole('menuitemradio')
    // The fixture's model defaults to the High effort: the checked row is where
    // the keyboard lands, not the top of the list.
    expect(rows[1]!.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(rows[1])
    // The walk continues from there.
    fireEvent.keyDown(rows[1]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[2])
  })

  it('keeps the card navigable when a pane has no rows, and leaves a retry its Tab', () => {
    const load = vi.fn()
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups: [], failures: [], status: 'error', error: 'catalog down',
    }))
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={directory}
      load={load} resolveText={resolveText}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    const retry = screen.getByRole('button', { name: '重试' })
    expect(fireEvent.mouseDown(retry)).toBe(false)
    fireEvent.click(retry)
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('group', { name: '模型与推理等级' })).toBeTruthy()
    retry.focus()
    // A control that is not a row keeps the browser's traversal.
    expect(fireEvent.keyDown(retry, { key: 'Tab' })).toBe(true)
    fireEvent.keyDown(retry, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: '模型与推理等级' })).toBeNull()
  })

  it('focuses the checked model in a small catalog', () => {
    mountOpen()
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows[0]!.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(document.activeElement).toBe(rows[0])
  })

  it('Escape returns to the root pane with the keyboard on the cell that drilled in', () => {
    mountOpen()
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const rows = screen.getAllByRole('menuitemradio')
    fireEvent.keyDown(rows[0]!, { key: 'Escape' })
    // The root pane is back with its two cells.
    const cells = screen.getAllByRole('menuitem')
    // Back on the drilled cell, so the next keystroke still reaches the menu.
    expect(document.activeElement).toBe(cells[1])
    expect(screen.getByRole('menu')).toBeTruthy()
    // A second Escape closes back to the trigger.
    fireEvent.keyDown(cells[1]!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Escape from the model list lands back on the model cell', () => {
    mountOpen()
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    fireEvent.keyDown(screen.getAllByRole('menuitemradio')[0]!, { key: 'Escape' })
    const cells = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(cells[0])
  })

  it('focuses the first row when no model is checked in a small catalog', () => {
    // The session runs a model the catalog no longer lists: no row is checked.
    render(<ModelSelect renderSlot={renderLabel}
      locked={false}
      available
      directory={createSnapshotStore(state({ current: { provider: 'gone', model: 'gone' } }))}
      load={vi.fn()} resolveText={resolveText}
      select={vi.fn().mockResolvedValue({ ok: true, value: undefined })}
      t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows.every(row => row.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(document.activeElement).toBe(rows[0])
  })

  it('Tab from a run-option switch closes the menu back to the trigger like Shift+Tab', async () => {
    const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: {} })
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state())}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t} useProjection={projectionHook(runOptions)}
      setRunOptions={vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))} />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const toggle = screen.getByRole('switch', { name: '快速模式' })
    toggle.focus()
    expect(fireEvent.keyDown(toggle, { key: 'Tab' })).toBe(false)
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('Tab from a Claude Code effort choice closes the menu without writing it', async () => {
    const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: {} })
    const setRunOptions = vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state())}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t} useProjection={projectionHook(runOptions)}
      setRunOptions={setRunOptions} />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const max = within(screen.getByRole('radiogroup', { name: zh['runOptions.effort'] }))
      .getByRole('radio', { name: zh['runOptions.effortMax'] })
    max.focus()
    expect(fireEvent.keyDown(max, { key: 'Tab' })).toBe(false)
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    expect(setRunOptions).not.toHaveBeenCalled()
  })
})

describe('ModelSelect catalog size', () => {
  it.each([0, 1, 4, 5])('shows search only above four models (%i models)', (count) => {
    const groups = modelGroups(count)
    const current = { provider: 'deepseek-official', model: count > 1 ? 'model-2' : 'deepseek-v4-flash' }
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state({ groups, current }))}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t} />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    if (count > 0) fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    const rows = screen.queryAllByRole('menuitemradio')
    expect(rows).toHaveLength(count)
    if (count > 4) {
      const search = screen.getByRole('searchbox')
      expect(search).toBeInstanceOf(HTMLInputElement)
      expect(document.activeElement).toBe(search)
      expect(search.getAttribute('aria-activedescendant')).toBe(rows[1]!.id)
      expect(rows.every(row => row.tabIndex === -1)).toBe(true)
    } else {
      expect(screen.queryByRole('searchbox')).toBeNull()
      expect(document.activeElement).toBe(count === 0 ? trigger : rows[count > 1 ? 1 : 0])
      expect(rows.every(row => row.tabIndex === 0)).toBe(true)
    }
    if (count === 0) expect(screen.getByRole('status').textContent).toBe(zh['empty.models'])
  })

  it.each([0, 1, 4, 5])('opens an unselected %i-model catalog on search or its first row', (count) => {
    render(<ModelSelect renderSlot={renderLabel} locked={false} available
      directory={createSnapshotStore(state({ groups: modelGroups(count), current: null }))}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t} />)
    const trigger = screen.getByRole('button', { name: '请选择模型' })
    fireEvent.click(trigger)
    const rows = screen.queryAllByRole('menuitemradio')
    expect(rows).toHaveLength(count)
    expect(rows.every(row => row.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(document.activeElement).toBe(count > 4 ? screen.getByRole('searchbox') : rows[0] ?? trigger)
    if (count <= 4) expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it.each([true, false])('clears search and restores focus across 5 → 4 → 5 models (checked: %s)', (checked) => {
    const current = { provider: 'deepseek-official', model: checked ? 'model-3' : 'removed' }
    const directory = createSnapshotStore(state({ groups: modelGroups(5), current }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    if (checked) fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'Model 5' } })
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(1)
    expect(screen.getByRole('searchbox')).toBe(search)
    expect(document.activeElement).toBe(search)

    act(() => { directory.set(state({ groups: modelGroups(4), current })) })
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('button', { name: '清除搜索' })).toBeNull()
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows).toHaveLength(4)
    expect(document.activeElement).toBe(rows[checked ? 2 : 0])

    act(() => { directory.set(state({ groups: modelGroups(5), current })) })
    const restored = screen.getByRole('searchbox')
    expect(restored.getAttribute('value')).toBe('')
    expect(document.activeElement).toBe(restored)
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(5)
    expect(restored.getAttribute('aria-activedescendant'))
      .toBe(screen.getAllByRole('menuitemradio')[checked ? 2 : 0]!.id)
  })

  it('moves actual row focus with arrows, leaves Enter native, and selects with Tab in a small catalog', async () => {
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    render(<ModelSelect renderSlot={renderLabel} locked={false} available
      directory={createSnapshotStore(state({ groups: modelGroups(4), current: { provider: 'deepseek-official', model: 'model-2' } }))}
      load={vi.fn()} resolveText={resolveText} select={select} t={t} />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    const rows = screen.getAllByRole('menuitemradio')
    expect(document.activeElement).toBe(rows[1])
    expect(fireEvent.keyDown(rows[1]!, { key: 'ArrowDown' })).toBe(false)
    expect(document.activeElement).toBe(rows[2])
    fireEvent.keyDown(rows[2]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[3])
    fireEvent.keyDown(rows[3]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows[3])
    fireEvent.keyDown(rows[3]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows[2])
    expect(rows[2]!.hasAttribute('data-highlighted')).toBe(true)
    expect(fireEvent.keyDown(rows[2]!, { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(rows[2]!, { key: 'ArrowLeft' })).toBe(true)
    expect(document.activeElement).toBe(rows[2])
    expect(select).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(rows[2]!, { key: 'Tab' })).toBe(false)
    expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'model-3' })
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    expect(screen.queryByRole('group', { name: '模型与推理等级' })).toBeNull()
    expect(trigger.hasAttribute('data-selection-focus')).toBe(true)
  })

  it('keeps Tab selection available after hovering a small-catalog row', async () => {
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state({ groups: modelGroups(4) }))}
      load={vi.fn()} resolveText={resolveText} select={select} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    const row = screen.getByRole('menuitemradio', { name: 'Model 3' })
    fireEvent.mouseMove(row)
    expect(document.activeElement).toBe(row)
    expect(row.hasAttribute('data-highlighted')).toBe(true)
    expect(fireEvent.keyDown(row, { key: 'Tab' })).toBe(false)
    expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'model-3' })
    await waitFor(() => { expect(screen.queryByRole('group', { name: '模型与推理等级' })).toBeNull() })
  })

  it.each(['Escape', 'Tab'])('leaves a small model pane with %s and returns to its root cell', (key) => {
    const select = vi.fn()
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state({ groups: modelGroups(4) }))}
      load={vi.fn()} resolveText={resolveText} select={select} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    const row = screen.getAllByRole('menuitemradio')[0]!
    expect(fireEvent.keyDown(row, { key, shiftKey: key === 'Tab' })).toBe(false)
    const cell = screen.getByRole('menuitem', { name: /^模型/ })
    expect(document.activeElement).toBe(cell)
    expect(select).not.toHaveBeenCalled()
    fireEvent.keyDown(cell, { key, shiftKey: key === 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ModelSelect search', () => {
  it('clears search when reopening an unselected large catalog', () => {
    render(<ModelSelect renderSlot={renderLabel} locked={false} available
      directory={createSnapshotStore(state({ groups: modelGroups(5), current: null }))}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t} />)
    const trigger = screen.getByRole('button', { name: '请选择模型' })
    fireEvent.click(trigger)
    const search = screen.getByRole('searchbox')
    expect(document.activeElement).toBe(search)
    fireEvent.change(search, { target: { value: 'zzzz' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: '模型与推理等级' })).toBeNull()
    fireEvent.click(trigger)
    expect(screen.getByRole('searchbox').getAttribute('value')).toBe('')
    expect(document.activeElement).toBe(screen.getByRole('searchbox'))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(5)
  })

  it('hides empty provider headings and announces an empty catalog', () => {
    const directory = createSnapshotStore(state({ groups: [
      ...state().groups, { id: 'empty', name: 'Empty Provider', models: [] },
    ] }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.queryByRole('group', { name: 'Empty Provider' })).toBeNull()
    act(() => { directory.set(state({ groups: [] })) })
    expect(screen.getByRole('status').textContent).toBe(zh['empty.models'])
    expect(screen.getByRole('status').closest('[role="menu"]')).toBeNull()
  })

  it.each(['Enter', 'Tab'])('returns focus silently after %s accepts the current model, without suppressing later focus', async (key) => {
    const select = vi.fn()
    render(<>
      <button type="button">Outside</button>
      <ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state({ groups: modelGroups(5) }))}
        load={vi.fn()} resolveText={resolveText} select={select} t={t} />
    </>)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.keyDown(screen.getByRole('searchbox'), { key })
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    expect(trigger.hasAttribute('data-selection-focus')).toBe(true)
    expect(select).not.toHaveBeenCalled()
    act(() => { screen.getByRole('button', { name: 'Outside' }).focus() })
    expect(trigger.hasAttribute('data-selection-focus')).toBe(false)
    act(() => { trigger.focus() })
    expect(trigger.hasAttribute('data-selection-focus')).toBe(false)
  })

  it.each(['Enter', 'Tab'])('keeps typing focus while arrows wrap across groups and %s accepts the highlight', async (key) => {
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'beta' },
      groups: [
        { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }] },
        { id: 'other', name: 'Other', models: [
          { id: 'delta', name: 'Delta' }, { id: 'epsilon', name: 'Epsilon' }, { id: 'gamma', name: 'Gamma' },
        ] },
      ],
    }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={select} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    const search = screen.getByRole('searchbox')
    expect(search).toBeInstanceOf(HTMLInputElement)
    const [alpha, beta, delta, epsilon, gamma] = screen.getAllByRole('menuitemradio')
    expect(search.getAttribute('aria-activedescendant')).toBe(beta!.id)
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search.getAttribute('aria-activedescendant')).toBe(delta!.id)
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search.getAttribute('aria-activedescendant')).toBe(epsilon!.id)
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search.getAttribute('aria-activedescendant')).toBe(gamma!.id)
    expect(document.activeElement).toBe(search)
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search.getAttribute('aria-activedescendant')).toBe(alpha!.id)
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(search.getAttribute('aria-activedescendant')).toBe(gamma!.id)
    expect(gamma!.hasAttribute('data-highlighted')).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(scrollIntoView.mock.instances.at(-1)).toBe(gamma)
    expect(fireEvent.keyDown(search, { key: 'ArrowLeft' })).toBe(true)
    expect(fireEvent.keyDown(search, { key: 'ArrowRight' })).toBe(true)
    fireEvent.keyDown(search, { key: 'ArrowDown', isComposing: true })
    expect(search.getAttribute('aria-activedescendant')).toBe(gamma!.id)
    fireEvent.change(search, { target: { value: 'alp' } })
    expect(search.getAttribute('aria-activedescendant')).toBe(screen.getByRole('menuitemradio', { name: 'Alpha' }).id)
    fireEvent.change(search, { target: { value: 'zzzz' } })
    expect(search.hasAttribute('aria-activedescendant')).toBe(false)
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(select).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(search, { key: 'Tab' })).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    const restored = screen.getAllByRole('menuitemradio')
    expect(search.getAttribute('aria-activedescendant')).toBe(restored[0]!.id)
    fireEvent.mouseMove(restored[4]!)
    expect(search.getAttribute('aria-activedescendant')).toBe(restored[4]!.id)
    expect(document.activeElement).toBe(search)
    fireEvent.keyDown(search, { key })
    expect(select).toHaveBeenCalledWith({ provider: 'other', model: 'gamma' })
    await waitFor(() => { expect(screen.queryByRole('group', { name: '模型与推理等级' })).toBeNull() })
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    expect(trigger.hasAttribute('data-selection-focus')).toBe(true)
  })

  it('filters model names fuzzily, hides empty groups, clears on reopening, and selects a result', async () => {
    const directory = createSnapshotStore(state({ groups: [
      ...modelGroups(4),
      { id: 'other', name: 'Other', models: [{ id: 'gemini', name: 'Gemini Flash' }] },
    ] }))
    const select = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={select} t={t} />)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    const search = screen.getByRole('searchbox')
    expect(document.activeElement).toBe(search)
    expect(search.closest('[role="menu"]')).toBeNull()
    expect(fireEvent.keyDown(search, { key: 'ArrowDown', isComposing: true })).toBe(true)
    expect(document.activeElement).toBe(search)
    fireEvent.change(search, { target: { value: '  GMFL  ' } })
    expect(screen.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['Gemini Flash'])
    expect(screen.getByRole('searchbox')).toBe(search)
    expect(document.activeElement).toBe(search)
    expect(screen.queryByRole('group', { name: 'DeepSeek' })).toBeNull()
    expect(trigger.textContent).toContain('DeepSeek-V4-Flash')
    fireEvent.change(search, { target: { value: 'zzzz' } })
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('没有匹配的模型。')
    expect(status.closest('[role="menu"]')).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(fireEvent.keyDown(search, { key: 'ArrowDown' })).toBe(false)
    expect(document.activeElement).toBe(search)
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    expect(search.getAttribute('value')).toBe('')
    expect(document.activeElement).toBe(search)
    expect(screen.queryByRole('button', { name: '清除搜索' })).toBeNull()
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(5)
    fireEvent.change(search, { target: { value: 'gmfl' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.getByRole('searchbox').getAttribute('value')).toBe('')
    const reopened = screen.getByRole('searchbox')
    fireEvent.change(reopened, { target: { value: 'gmfl' } })
    const row = screen.getByRole('menuitemradio', { name: 'Gemini Flash' })
    expect(screen.getByRole('menu', { name: '模型' }).contains(row)).toBe(true)
    fireEvent.keyDown(reopened, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(reopened)
    expect(reopened.getAttribute('aria-activedescendant')).toBe(row.id)
    fireEvent.keyDown(reopened, { key: 'Tab' })
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    expect(select).toHaveBeenCalledWith({ provider: 'other', model: 'gemini' })
  })
})

it('shows the unselected model control with the inherited effort until a listed model is selected', () => {
  const directory = createSnapshotStore<ModelDirectoryState>(state({ current: null, routable: false, retainedEffort: 'High' }))
  render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
    resolveText={resolveText} select={vi.fn()} t={t} />)
  const trigger = screen.getByRole('button', { name: '请选择模型' })
  expect(trigger.hasAttribute('disabled')).toBe(false)
  expect(trigger.textContent).toBe('请选择模型High')
  fireEvent.click(trigger)
  expect(screen.queryByRole('menuitem', { name: /模型/ })).toBeNull()
  expect(screen.queryByRole('searchbox')).toBeNull()
  const row = screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })
  expect(document.activeElement).toBe(row)
  fireEvent.keyDown(row, { key: 'Escape' })
  expect(screen.queryByRole('group', { name: '模型与推理等级' })).toBeNull()
  fireEvent.click(trigger)
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' }))
})

it('places account and official models before third-party models', async () => {
  const groups = ['custom', 'deepseek-official', 'deepseek-account', 'another'].map(id => ({
    id, name: id, models: [1, 2].map(index => ({ id: `${id}-${index}`, name: `${id}-${index}` })),
  }))
  const directory = createSnapshotStore<ModelDirectoryState>(state({ current: null, groups }))
  render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
    resolveText={resolveText} select={vi.fn()} t={t} />)
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
  render(<ModelSelect renderSlot={renderLabel} locked={false} available
    directory={createSnapshotStore(state({ current: null, groups }))}
    load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: zh['trigger.selectAria'] }))
  expect(screen.getByText(zh['option.deepseekV4Flash.description'])).toBeTruthy()
})

it.each([en, zh])('localizes the account group while preserving external names', (copy) => {
  const groups = ['deepseek-account', 'custom'].map(id => ({
    id, name: id === 'deepseek-account' ? 'DeepSeek Account' : 'My Gateway',
    models: [{ id: 'model', name: 'Model' }],
  }))
  render(<ModelSelect renderSlot={renderLabel} locked={false} available
    directory={createSnapshotStore(state({ current: null, groups }))}
    load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={key => key in copy ? copy[key as keyof typeof copy] : key} />)
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
  render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
    resolveText={resolveText} select={vi.fn()} t={t} />)
  expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent).toBe('DeepSeek FlashHigh')
  act(() => { directory.update((snapshot) => { snapshot.groups = []; snapshot.routable = false }) })
  expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent).toBe('deepseek-flashHigh')
  act(() => { directory.update((snapshot) => { snapshot.groups = groups; snapshot.routable = true }) })
  expect(screen.getByRole('button', { name: /选择模型，当前/ }).textContent).toBe('DeepSeek FlashHigh')
  expect(directory.getSnapshot().current).toEqual(selected)
})

it('names an unlisted selection by its last advertised catalog name', () => {
  const directory = createSnapshotStore(state({
    current: { provider: 'anthropic', model: 'claude-opus-5-5' },
    retainedName: 'Claude Opus 5.5',
  }))
  render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
    resolveText={resolveText} select={vi.fn()} t={t} />)
  expect(screen.getByRole('button', { name: '选择模型，当前 Claude Opus 5.5' }).textContent).toBe('Claude Opus 5.5')
})

it('shows the bare model id on the trigger and the provider/model in its title when no name is known', () => {
  const directory = createSnapshotStore(state({ current: { provider: 'anthropic', model: 'claude-opus-5-5' } }))
  render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
    resolveText={resolveText} select={vi.fn()} t={t} />)
  const trigger = screen.getByRole('button', { name: '选择模型，当前 anthropic/claude-opus-5-5' })
  expect(trigger.textContent).toBe('claude-opus-5-5')
  expect(trigger.getAttribute('title')).toBe('anthropic/claude-opus-5-5')
})

it('pins an unlisted selection as a disabled checked row under the current session with a warning trigger', () => {
  const directory = createSnapshotStore(state({
    current: { provider: 'anthropic', model: 'claude-opus-5-5' },
    routable: false,
    retainedName: 'Claude Opus 5.5',
  }))
  render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
    resolveText={resolveText} select={vi.fn()} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: '选择模型，当前 Claude Opus 5.5，不可用' }))
  const row = screen.getByRole('menuitemradio', { name: 'Claude Opus 5.5' })
  expect(row.getAttribute('aria-checked')).toBe('true')
  expect(row.hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('group', { name: zh['current.title'] }).contains(row)).toBe(true)
  expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' }).getAttribute('aria-checked')).toBe('false')
})

it('locks the model rows and the effort choice while Orchestrator & Subagent Setup is on, and opens that view', () => {
  const openSubagentSetup = vi.fn()
  const lockedSetup = { enabled: true, roles: { orchestrator: { mode: 'fixed', route: { backend: 'llm', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' } } } }
  const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({
    current: { subagentSetup: lockedSetup },
  } as SessionRunOptionsProjection)
  render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state())}
    load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t}
    useProjection={projectionHook(runOptions)} setRunOptions={vi.fn()} openSubagentSetup={openSubagentSetup} />)
  fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
  expect(screen.getByRole('note').textContent).toContain(zh['subagentSetup.notice'])
  expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh['subagentSetup.open'] }))
  expect(openSubagentSetup).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('menu')).toBeNull()
})

describe('ModelSelect run options and Ultracode', () => {
  it('toggles fast mode through its switch and keeps the Ultracode level off a model without it', async () => {
    const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: { fastMode: true, ultracode: true } })
    const setRunOptions = vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state())}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t}
      useProjection={projectionHook(runOptions)} setRunOptions={setRunOptions} />)
    const trigger = screen.getByRole('button', { name: /选择模型，当前/ })
    expect(trigger.textContent).toContain(zh['trigger.fast'])
    expect(trigger.textContent).not.toContain(zh['trigger.ultracode'])
    expect(trigger.getAttribute('aria-label')).toBe(`选择模型，当前 DeepSeek-V4-Flash，推理等级 High，已开启：${zh['trigger.fast']}`)
    fireEvent.click(trigger)
    expect(screen.getByText(zh['menu.saved'])).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getByRole('switch', { name: '快速模式' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('menuitemradio', { name: 'Ultracode' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Ultracode' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: '快速模式' }))
    await waitFor(() => { expect(setRunOptions).toHaveBeenCalledWith({ fastMode: false, ultracode: true }) })
  })

  it('announces a rejected run-option write in the toast', async () => {
    const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: {} })
    const setRunOptions = vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError('session/model-unavailable', 'run options rejected', { provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
    }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(capableState())}
      load={vi.fn()} resolveText={resolveText}
      select={vi.fn(async () => ({ ok: true as const, value: undefined }))} t={t}
      useProjection={projectionHook(runOptions)} setRunOptions={setRunOptions} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ultracode' }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toBe('模型操作失败：session/model-unavailable: run options rejected')
  })

  it('offers Ultracode as the last effort level only for a model that supports it', () => {
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(capableState())}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t}
      useProjection={projectionHook(createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: {} }))}
      setRunOptions={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Off', 'High', 'Max', 'Ultracode'])
    expect(screen.queryByRole('switch', { name: 'Ultracode' })).toBeNull()
  })

  it('selects the XHigh effort with Ultracode, as Claude Code does, not the top Max level', async () => {
    const xhighReasoning = {
      efforts: [{ id: 'high', name: 'High' }, { id: 'xhigh', name: 'XHigh' }, { id: 'max', name: 'Max' }],
      defaultEffort: 'high',
    }
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'anthropic', model: 'claude-opus-5-5' },
      groups: [{ id: 'anthropic', name: 'Anthropic', models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', reasoning: xhighReasoning, ultracode: true }] }],
    }))
    const select = vi.fn(async (_selection: ModelSelection) => ({ ok: true as const, value: undefined }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={directory} load={vi.fn()}
      resolveText={resolveText} select={select} t={t}
      useProjection={projectionHook(createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: {} }))}
      setRunOptions={vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ultracode' }))
    await waitFor(() => { expect(select).toHaveBeenCalledWith({ provider: 'anthropic', model: 'claude-opus-5-5', reasoningEffort: 'xhigh' }) })
  })

  it('hides the Claude Code section when the Session has no runOptions projection', () => {
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state())}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t} setRunOptions={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.queryByText(zh['runOptions.title'])).toBeNull()
  })

  it('builds a second run-option write on the first before the projection catches up', async () => {
    const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: {} })
    const setRunOptions = vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(capableState())}
      load={vi.fn()} resolveText={resolveText}
      select={vi.fn(async () => ({ ok: true as const, value: undefined }))} t={t}
      useProjection={projectionHook(runOptions)} setRunOptions={setRunOptions} />)
    const trigger = screen.getByRole('button', { name: /选择模型，当前/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    fireEvent.click(screen.getByRole('switch', { name: '快速模式' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ultracode' }))
    await waitFor(() => { expect(setRunOptions).toHaveBeenCalledTimes(2) })
    expect(setRunOptions.mock.calls).toEqual([[{ fastMode: true }], [{ fastMode: true, ultracode: true }]])
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    act(() => { runOptions.set({ current: { fastMode: true, ultracode: true } }) })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getByRole('menuitemradio', { name: 'Ultracode' }).getAttribute('aria-checked')).toBe('true')
  })

  it('sends run-option writes one at a time and voids those queued behind a rejected one', async () => {
    const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: {} })
    const first = Promise.withResolvers<RemoteResult<SessionRunOptions>>()
    const setRunOptions = vi.fn<(options: SessionRunOptions) => Promise<RemoteResult<SessionRunOptions>>>()
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async options => ({ ok: true as const, value: options }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(capableState())}
      load={vi.fn()} resolveText={resolveText}
      select={vi.fn(async () => ({ ok: true as const, value: undefined }))} t={t}
      useProjection={projectionHook(runOptions)} setRunOptions={setRunOptions} />)
    const trigger = screen.getByRole('button', { name: /选择模型，当前/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    fireEvent.click(screen.getByRole('switch', { name: '快速模式' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ultracode' }))
    await waitFor(() => { expect(setRunOptions).toHaveBeenCalledTimes(1) })
    first.resolve({ ok: false, error: new RemoteError('session/writer-held', 'held', { sessionId: SessionId('s1') }) })
    await screen.findByRole('alert')
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getByRole('switch', { name: '快速模式' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('menuitemradio', { name: 'Ultracode' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ultracode' }))
    await waitFor(() => { expect(setRunOptions).toHaveBeenCalledTimes(2) })
    expect(setRunOptions.mock.calls).toEqual([[{ fastMode: true }], [{ ultracode: true }]])
  })

  it('writes the Claude Code effort with the other run options and clears it with Default', async () => {
    const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current: { fastMode: true } })
    const setRunOptions = vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))
    render(<ModelSelect renderSlot={renderLabel} locked={false} available directory={createSnapshotStore(state())}
      load={vi.fn()} resolveText={resolveText} select={vi.fn()} t={t}
      useProjection={projectionHook(runOptions)} setRunOptions={setRunOptions} />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const group = screen.getByRole('radiogroup', { name: zh['runOptions.effort'] })
    expect(within(group).getByRole('radio', { name: zh['runOptions.effortDefault'] }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(group).getByRole('radio', { name: zh['runOptions.effortMax'] }))
    await waitFor(() => { expect(setRunOptions).toHaveBeenCalledWith({ fastMode: true, effort: 'max' }) })
    act(() => { runOptions.set({ current: { fastMode: true, effort: 'max' } }) })
    fireEvent.click(within(group).getByRole('radio', { name: zh['runOptions.effortDefault'] }))
    await waitFor(() => { expect(setRunOptions).toHaveBeenLastCalledWith({ fastMode: true, effort: undefined }) })
  })
})
