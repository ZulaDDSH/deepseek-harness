// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { OwnerOf } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function setup(autoFocus = true, paneKey = 'fixture', paneTitle = 'Fixture settings', afterDismiss?: () => void) {
  const directory = createSnapshotStore<ModelDirectoryState>({
    current: { provider: 'fixture', model: 'fixture' }, routable: true,
    groups: [{ id: 'fixture', name: 'Fixture', models: [{ id: 'fixture', name: 'Fixture' }] }],
    failures: [], status: 'ready', pending: null, error: null,
  })
  const change = vi.fn()
  const select = vi.fn()
  const useModelDirectory = bindSnapshotSelector(directory)
  const useModelFavorites = bindSnapshotSelector(createSnapshotStore<string[]>([]))
  const renderSlot: ComponentProps<typeof ModelSelect>['renderSlot'] = (name, owner, options) => {
    if (name === 'conversation.input.model.options') {
      const controls = owner as object as OwnerOf<'conversation.input.model.options'>
      return <button type="button" role="menuitem" data-model-menu-pane={paneKey} disabled={controls.locked}
        onClick={() => { controls.openPane({ key: paneKey, title: paneTitle }) }}>{paneTitle}</button>
    }
    if (name === 'conversation.input.model.pane') {
      const controls = owner as object as OwnerOf<'conversation.input.model.pane'>
      expect(options?.entryKey).toBe(paneKey)
      return <><button type="button" role="switch" aria-checked="false" disabled={controls.locked}
        autoFocus={autoFocus} onClick={change}>Fixture setting</button>
      {afterDismiss !== undefined && <button type="button" onClick={() => { controls.dismiss(); afterDismiss() }}>Open confirmation</button>}
      <p>Fixture explanation</p></>
    }
    return options?.fallback ?? null
  }
  render(<ModelSelect locked={false} available useModelDirectory={useModelDirectory} useModelFavorites={useModelFavorites}
    useProjection={() => undefined} toggleFavorite={vi.fn()} cliProfiles={vi.fn(async () => [])}
    openCliTerminal={vi.fn(async () => {})} load={vi.fn()} select={select}
    resolveText={text => typeof text === 'string' ? text : text.en} t={makeTranslate(en)} renderSlot={renderSlot} />)
  const trigger = screen.getByRole('button', { name: /^Select model/ })
  fireEvent.click(trigger)
  return { trigger, change, select, directory }
}

it('dispatches a keyed page and returns focus to its invoking summary on Escape', () => {
  const { trigger, change, select } = setup()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Fixture settings' }))
  const toggle = screen.getByRole('switch')
  expect(document.activeElement).toBe(toggle)
  expect(screen.getByRole('group', { name: 'Fixture settings' })).toBeTruthy()
  fireEvent.blur(toggle, { relatedTarget: null })
  expect(screen.getByText('Fixture explanation')).toBeTruthy()
  fireEvent.keyDown(toggle, { key: 'Escape' })
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Fixture settings' }))
  expect(screen.queryByRole('switch')).toBeNull()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(change).not.toHaveBeenCalled()
  expect(select).not.toHaveBeenCalled()
})

it('routes the Agent Teams menu entry through its keyed model chooser pane', () => {
  const { trigger } = setup(true, 'agent-team', 'Agent teamwork')
  const summary = screen.getByRole('menuitem', { name: 'Agent teamwork' })
  expect(summary.getAttribute('data-model-menu-pane')).toBe('agent-team')
  fireEvent.click(summary)
  expect(screen.getByRole('group', { name: 'Agent teamwork' })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('switch'), { key: 'Escape' })
  expect(document.activeElement).toBe(summary)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
})

it('hands focus to an immediately opened confirmation after dismissing the Team pane', async () => {
  const confirmation = document.createElement('button')
  document.body.append(confirmation)
  try {
    const { trigger } = setup(true, 'agent-team', 'Agent teamwork', () => { confirmation.focus() })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Agent teamwork' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }))
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(confirmation)
    await act(async () => {})
    expect(document.activeElement).toBe(confirmation)
  } finally {
    confirmation.remove()
  }
})

it('keeps focus on the page surface when the page places none, so Escape still returns', () => {
  setup(false)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Fixture settings' }))
  const surface = screen.getByRole('group', { name: 'Fixture settings' })
  expect(document.activeElement).toBe(surface)
  fireEvent.keyDown(surface, { key: 'Escape' })
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Fixture settings' }))
})

it('closes a detail pane on an outside touch press that dispatches no mousedown', () => {
  const { trigger } = setup()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Fixture settings' }))
  fireEvent.blur(screen.getByRole('switch'), { relatedTarget: null })
  fireEvent.pointerDown(screen.getByText('Fixture explanation'))
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  fireEvent.pointerDown(document.body)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

it.each([false, true])('closes a detail pane on Tab without changing its setting (shift: %s)', async (shiftKey) => {
  const { trigger, change } = setup()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Fixture settings' }))
  fireEvent.keyDown(screen.getByRole('switch'), { key: 'Tab', shiftKey })
  await act(async () => {})
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(trigger)
  expect(change).not.toHaveBeenCalled()
})

it('keeps the baseline model-save lock on both summary and detail controls', () => {
  const { directory } = setup()
  act(() => { directory.update((state) => { state.pending = { provider: 'fixture', model: 'fixture' } }) })
  expect(screen.getByRole('menuitem', { name: 'Fixture settings' }).hasAttribute('disabled')).toBe(true)
  act(() => { directory.update((state) => { state.pending = null }) })
  fireEvent.click(screen.getByRole('menuitem', { name: 'Fixture settings' }))
  act(() => { directory.update((state) => { state.pending = { provider: 'fixture', model: 'fixture' } }) })
  expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true)
})
