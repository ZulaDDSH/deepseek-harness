// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionRunOptions, SessionRunOptionsProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { useMemo, useSyncExternalStore, type ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
const cliStubs = { cliProfiles: vi.fn(async () => []), openCliTerminal: vi.fn(async () => {}) }
const renderLabel: ComponentProps<typeof ModelSelect>['renderSlot'] = (_name, _owner, options) => options?.fallback ?? null
const resolveText: ComponentProps<typeof ModelSelect>['resolveText'] = text => typeof text === 'string' ? text : text.en

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })

const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? (commonEn as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

/** Renderer stand-in for useProjection: the Session's run options, and the Claude Code capability only when a provider is installed. */
function projectionHook(runOptions: SnapshotStore<SessionRunOptionsProjection | undefined>, claudeCode: boolean) {
  return (key: string) => useSyncExternalStore(
    listener => runOptions.subscribe(listener),
    () => key === 'runOptions' ? runOptions.getSnapshot() : key === 'claudeCodeRunOptions' && claudeCode ? true : undefined,
  )
}

type SeatProps = Omit<ComponentProps<typeof ModelSelect>, 'useModelDirectory' | 'useModelFavorites'> & {
  directory: SnapshotStore<ModelDirectoryState>
  favorites: SnapshotStore<string[]>
}
/** Renderer stand-in for the inject hooks compartment: binds the two stores the way the slot renderer does. */
function Seat({ directory, favorites, ...props }: SeatProps) {
  const useModelDirectory = useMemo(() => bindSnapshotSelector(directory), [directory])
  const useModelFavorites = useMemo(() => bindSnapshotSelector(favorites), [favorites])
  return <ModelSelect
    {...props} useModelDirectory={useModelDirectory} useModelFavorites={useModelFavorites}
  />
}

function directoryState(ultracode: boolean): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' },
        ...ultracode ? { ultracode: true } : {},
      }],
    }],
    failures: [],
    status: 'ready',
    pending: null,
    error: null,
  }
}

function renderSeat(
  claudeCode: boolean, current: SessionRunOptions, ultracode = false,
  models: ModelDirectoryState = directoryState(ultracode),
) {
  const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current })
  const setRunOptions = vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))
  const select = vi.fn(async () => ({ ok: true as const, value: undefined }))
  render(<Seat
    locked={false} useProjection={projectionHook(runOptions, claudeCode)} favorites={createSnapshotStore<string[]>([])}
    toggleFavorite={vi.fn()}
    {...cliStubs} available renderSlot={renderLabel} resolveText={resolveText}
    directory={createSnapshotStore(models)} load={vi.fn()} select={select}
    setRunOptions={setRunOptions} t={t} />)
  return { setRunOptions, select, trigger: screen.getByRole('button', { name: /Select model, current/ }) }
}

function openEffort() {
  fireEvent.click(screen.getByRole('menuitem', { name: /^Effort/ }))
}

function openModel() {
  fireEvent.click(screen.getByRole('menuitem', { name: /^Model/ }))
}

afterEach(cleanup)

it('shows the Ultracode level and trigger tag for a model that supports it, and hides the Claude-only rows', () => {
  const { trigger } = renderSeat(false, { ultracode: true, fastMode: true }, true)
  expect(trigger.textContent).toContain(en['trigger.ultracode'])
  expect(trigger.textContent).not.toContain(en['trigger.fast'])
  expect(trigger.textContent).toContain(en['trigger.ultracodeEffort'].replace('{effort}', 'Low'))
  fireEvent.click(trigger)
  openEffort()
  expect(screen.getByRole('menuitemradio', { name: en['runOptions.ultracode'] }).getAttribute('aria-checked')).toBe('true')
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.queryByRole('radiogroup', { name: en['runOptions.effort'] })).toBeNull()
})

it('hides Ultracode everywhere for a model without it, even when the Session carries the flag', () => {
  const { trigger } = renderSeat(false, { ultracode: true })
  expect(trigger.textContent).not.toContain(en['trigger.ultracode'])
  fireEvent.click(trigger)
  openEffort()
  expect(screen.queryByRole('menuitemradio', { name: en['runOptions.ultracode'] })).toBeNull()
  expect(screen.queryByRole('switch', { name: en['runOptions.ultracode'] })).toBeNull()
})

it('writes Ultracode at the highest effort and turns it off when another effort is chosen', async () => {
  const { setRunOptions, select, trigger } = renderSeat(false, {}, true)
  fireEvent.click(trigger)
  openEffort()
  fireEvent.click(screen.getByRole('menuitemradio', { name: en['runOptions.ultracode'] }))
  await waitFor(() => { expect(setRunOptions).toHaveBeenCalledWith({ ultracode: true }) })
  expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })
})

it('clears a stored Ultracode when another effort is chosen', async () => {
  const { setRunOptions, select, trigger } = renderSeat(false, { ultracode: true }, true)
  fireEvent.click(trigger)
  openEffort()
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))
  await waitFor(() => { expect(setRunOptions).toHaveBeenCalledWith({ ultracode: false }) })
  expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })
})

it('shows Fast mode and the Claude Code effort choice only with the Claude Code provider', () => {
  const { trigger } = renderSeat(true, { fastMode: true })
  expect(trigger.textContent).toContain(en['trigger.fast'])
  fireEvent.click(trigger)
  openEffort()
  expect(screen.getByRole('switch', { name: en['runOptions.fastMode'] }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('radiogroup', { name: en['runOptions.effort'] })).toBeTruthy()
  expect(screen.queryByRole('menuitemradio', { name: en['runOptions.ultracode'] })).toBeNull()
})

it('keeps the ordinary model and effort choices available when a saved setup record exists', () => {
  const current = { subagentSetup: { enabled: true, reviewRounds: 2, roles: { orchestrator: {
    mode: 'fixed' as const, route: { backend: 'llm' as const, provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  } } } }
  const { trigger } = renderSeat(false, current)
  fireEvent.click(trigger)
  openModel()
  expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Flash/ })).toHaveProperty('disabled', false)
  fireEvent.click(screen.getByRole('menuitem', { name: /^Effort/ }))
  expect(screen.getByRole('menuitemradio', { name: 'High' })).toHaveProperty('disabled', false)
})
