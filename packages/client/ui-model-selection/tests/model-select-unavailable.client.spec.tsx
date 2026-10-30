// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { useMemo, useSyncExternalStore, type ComponentProps } from 'react'
import type { SessionRunOptionsProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
const cliStubs = { cliProfiles: vi.fn(async () => []), openCliTerminal: vi.fn(async () => {}) }
const renderLabel: ComponentProps<typeof ModelSelect>['renderSlot'] = (_name, _owner, options) => options?.fallback ?? null
const resolveText: ComponentProps<typeof ModelSelect>['resolveText'] = text => typeof text === 'string' ? text : text.en

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

type SeatProps = Omit<ComponentProps<typeof ModelSelect>, 'useModelDirectory' | 'useModelFavorites' | 'useGlobalSetup'> & {
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
    {...props} useModelDirectory={useModelDirectory} useModelFavorites={useModelFavorites} useGlobalSetup={useGlobalSetup}
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

function renderSeat(overrides: Partial<ModelDirectoryState>) {
  const directory = createSnapshotStore<ModelDirectoryState>(state(overrides))
  render(<Seat
    locked={false} useProjection={noProjection}
    favorites={createSnapshotStore<string[]>([])}
    toggleFavorite={vi.fn()}
    {...cliStubs}
    renderSlot={renderLabel} resolveText={resolveText}
    available
    directory={directory}
    load={vi.fn()}
    select={vi.fn()}
    t={t}
  />)
  return screen.getByRole('button', { name: /选择模型，当前/ })
}

afterEach(cleanup)

describe('ModelSelect unroutable current model', () => {
  it('marks the trigger and explains the provider is not configured when the current provider is not listed', () => {
    const trigger = renderSeat({ routable: false, current: { provider: 'absent-provider', model: 'deepseek-v4-flash' } })

    expect(trigger.hasAttribute('data-unavailable')).toBe(true)
    expect(trigger.getAttribute('title')).toContain(zh['trigger.unavailableHint'])
    expect(trigger.getAttribute('title')).not.toContain(zh['trigger.unavailableModelHint'])
  })

  it('explains the model is missing from the provider catalog when the provider is still listed', () => {
    const trigger = renderSeat({ routable: false, current: { provider: 'deepseek-official', model: 'missing-model' } })

    expect(trigger.hasAttribute('data-unavailable')).toBe(true)
    expect(trigger.getAttribute('title')).toContain(zh['trigger.unavailableModelHint'])
    expect(trigger.getAttribute('title')).not.toContain(zh['trigger.unavailableHint'])
  })

  it('renders exactly one extra svg (the warning glyph) on the trigger when unroutable', () => {
    const routableSvgs = renderSeat({ routable: true }).querySelectorAll('svg').length
    cleanup()
    const unroutableSvgs = renderSeat({ routable: false }).querySelectorAll('svg').length

    expect(unroutableSvgs).toBe(routableSvgs + 1)
  })

  it('leaves the trigger unmarked when the current provider is routable', () => {
    const trigger = renderSeat({ routable: true })

    expect(trigger.hasAttribute('data-unavailable')).toBe(false)
    expect(trigger.getAttribute('title')).not.toContain(zh['trigger.unavailableHint'])
  })
})
