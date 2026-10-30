// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
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

type SeatProps = Omit<ComponentProps<typeof ModelSelect>, 'useModelDirectory' | 'useModelFavorites' | 'useGlobalSetup'> & {
  directory: SnapshotStore<ModelDirectoryState>
  favorites: SnapshotStore<string[]>
  globalSetup?: unknown
}
/** Renderer stand-in for the inject hooks compartment: binds the two stores the way the slot renderer does. */
function Seat({ directory, favorites, globalSetup, ...props }: SeatProps) {
  const useModelDirectory = useMemo(() => bindSnapshotSelector(directory), [directory])
  const useModelFavorites = useMemo(() => bindSnapshotSelector(favorites), [favorites])
  const globalStore = useMemo(() => createSnapshotStore<unknown>(globalSetup), [globalSetup])
  const useGlobalSetup = useMemo(() => bindSnapshotSelector(globalStore), [globalStore])
  return <ModelSelect
    {...props} useModelDirectory={useModelDirectory} useModelFavorites={useModelFavorites} useGlobalSetup={useGlobalSetup}
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
  claudeCode: boolean, current: SessionRunOptions, openSubagentSetup = vi.fn(), ultracode = false, globalSetup?: unknown,
  models: ModelDirectoryState = directoryState(ultracode),
) {
  const runOptions = createSnapshotStore<SessionRunOptionsProjection | undefined>({ current })
  const setRunOptions = vi.fn(async (options: SessionRunOptions) => ({ ok: true as const, value: options }))
  const select = vi.fn(async () => ({ ok: true as const, value: undefined }))
  render(<Seat
    locked={false} useProjection={projectionHook(runOptions, claudeCode)} favorites={createSnapshotStore<string[]>([])}
    globalSetup={globalSetup}
    toggleFavorite={vi.fn()}
    {...cliStubs} available renderSlot={renderLabel} resolveText={resolveText}
    directory={createSnapshotStore(models)} load={vi.fn()} select={select}
    setRunOptions={setRunOptions} openSubagentSetup={openSubagentSetup} t={t} />)
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
  const { trigger } = renderSeat(false, { ultracode: true, fastMode: true }, vi.fn(), true)
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
  const { setRunOptions, select, trigger } = renderSeat(false, {}, vi.fn(), true)
  fireEvent.click(trigger)
  openEffort()
  fireEvent.click(screen.getByRole('menuitemradio', { name: en['runOptions.ultracode'] }))
  await waitFor(() => { expect(setRunOptions).toHaveBeenCalledWith({ ultracode: true }) })
  expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })
})

it('clears a stored Ultracode when another effort is chosen', async () => {
  const { setRunOptions, select, trigger } = renderSeat(false, { ultracode: true }, vi.fn(), true)
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

const jevSetup: SessionRunOptions = { subagentSetup: { enabled: true, reviewRounds: 2, roles: { orchestrator: { mode: 'jev' } } } }
const fixedSetup: SessionRunOptions = {
  subagentSetup: {
    enabled: true,
    reviewRounds: 2,
    roles: { orchestrator: { mode: 'fixed', route: { backend: 'llm', provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
  },
}

it('keeps the picker openable while subagent mode is on, locks the model list, and links to Subagent Setup', () => {
  const openSubagentSetup = vi.fn()
  const { trigger } = renderSeat(false, jevSetup, openSubagentSetup)
  expect(trigger).toHaveProperty('disabled', false)
  fireEvent.click(trigger)
  openModel()
  expect(screen.getByRole('note').textContent).toContain(en['subagentSetup.notice'])
  expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Flash/ })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: en['subagentSetup.open'] }))
  expect(openSubagentSetup).toHaveBeenCalledTimes(1)
})

it('leaves Ultracode and Fast mode usable while subagent mode is on', async () => {
  const { setRunOptions, trigger } = renderSeat(true, jevSetup, vi.fn(), true)
  fireEvent.click(trigger)
  openEffort()
  fireEvent.click(screen.getByRole('switch', { name: en['runOptions.fastMode'] }))
  await waitFor(() => { expect(setRunOptions).toHaveBeenLastCalledWith({ ...jevSetup, fastMode: true }) })
  fireEvent.click(screen.getByRole('menuitemradio', { name: en['runOptions.ultracode'] }))
  await waitFor(() => { expect(setRunOptions).toHaveBeenLastCalledWith({ ...jevSetup, fastMode: true, ultracode: true }) })
})

it('keeps Ultracode selectable under a fixed orchestrator without changing its effort', async () => {
  const { setRunOptions, select, trigger } = renderSeat(false, fixedSetup, vi.fn(), true)
  fireEvent.click(trigger)
  openEffort()
  expect(screen.getByRole('menuitemradio', { name: 'High' })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('menuitemradio', { name: en['runOptions.ultracode'] }))
  await waitFor(() => { expect(setRunOptions).toHaveBeenCalledWith({ ...fixedSetup, ultracode: true }) })
  expect(select).not.toHaveBeenCalled()
})

it('locks the reasoning effort only when the orchestrator route is fixed', () => {
  const jev = renderSeat(false, jevSetup)
  fireEvent.click(jev.trigger)
  openEffort()
  expect(screen.getByRole('menuitemradio', { name: 'High' })).toHaveProperty('disabled', false)
  cleanup()
  const fixed = renderSeat(false, fixedSetup)
  fireEvent.click(fixed.trigger)
  openEffort()
  expect(screen.getByRole('menuitemradio', { name: 'High' })).toHaveProperty('disabled', true)
})

it('leaves the reasoning effort unlocked when the orchestrator is fixed to a Claude CLI route, which the Host does not drive', () => {
  const claudeSetup: SessionRunOptions = {
    subagentSetup: { enabled: true, reviewRounds: 2, roles: { orchestrator: { mode: 'fixed', route: { backend: 'claude-cli', model: 'opus' } } } },
  }
  const { trigger } = renderSeat(false, claudeSetup)
  fireEvent.click(trigger)
  openEffort()
  expect(screen.getByRole('menuitemradio', { name: 'High' })).toHaveProperty('disabled', false)
})

it('leaves the model list and effort unlocked while subagent mode is off', () => {
  const off = renderSeat(false, { subagentSetup: { ...fixedSetup.subagentSetup!, enabled: false } })
  fireEvent.click(off.trigger)
  openModel()
  expect(screen.queryByRole('note')).toBeNull()
  cleanup()
  const effort = renderSeat(false, { subagentSetup: { ...fixedSetup.subagentSetup!, enabled: false } })
  fireEvent.click(effort.trigger)
  openEffort()
  expect(screen.getByRole('menuitemradio', { name: 'High' })).toHaveProperty('disabled', false)
})

it('locks the model list for a Session with no setup of its own when the global default has subagent mode on', () => {
  const { trigger } = renderSeat(false, {}, vi.fn(), false, jevSetup.subagentSetup)
  fireEvent.click(trigger)
  openModel()
  expect(screen.getByRole('note').textContent).toContain(en['subagentSetup.notice'])
  expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Flash/ })).toHaveProperty('disabled', true)
})

it('locks the reasoning effort when the global default fixes the orchestrator', () => {
  const { trigger } = renderSeat(false, {}, vi.fn(), false, fixedSetup.subagentSetup)
  fireEvent.click(trigger)
  openEffort()
  expect(screen.getByRole('menuitemradio', { name: 'High' })).toHaveProperty('disabled', true)
})

it('lets the Session own setup win over the global default in both directions', () => {
  const off = renderSeat(false, { subagentSetup: { ...jevSetup.subagentSetup!, enabled: false } }, vi.fn(), false, fixedSetup.subagentSetup)
  fireEvent.click(off.trigger)
  openEffort()
  expect(screen.getByRole('menuitemradio', { name: 'High' })).toHaveProperty('disabled', false)
  cleanup()
  const on = renderSeat(false, jevSetup, vi.fn(), false, { ...jevSetup.subagentSetup!, enabled: false })
  fireEvent.click(on.trigger)
  openModel()
  expect(screen.getByRole('note').textContent).toContain(en['subagentSetup.notice'])
})

it('shows the fixed orchestrator route as the Session model only while subagent mode is on', () => {
  const orchestrator = { mode: 'fixed', route: { backend: 'llm', provider: 'deepseek-official', model: 'deepseek-v4-pro' } }
  const models = directoryState(false)
  const pro = { ...models, groups: [{ ...models.groups[0]!, models: [...models.groups[0]!.models, { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' }] }] }
  const driven = renderSeat(false, {}, vi.fn(), false, { enabled: true, reviewRounds: 2, roles: { orchestrator } }, pro)
  expect(driven.trigger.textContent).toContain('DeepSeek-V4-Pro')
  cleanup()
  const off = renderSeat(false, {}, vi.fn(), false, { enabled: false, reviewRounds: 2, roles: { orchestrator } }, pro)
  expect(off.trigger.textContent).toContain('DeepSeek-V4-Flash')
})

it('ignores a malformed global default as the Host does', () => {
  const { trigger } = renderSeat(false, {}, vi.fn(), false, { enabled: true })
  fireEvent.click(trigger)
  openModel()
  expect(screen.queryByRole('note')).toBeNull()
})
