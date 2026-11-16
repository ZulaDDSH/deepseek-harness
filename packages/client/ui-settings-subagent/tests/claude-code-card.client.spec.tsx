// @vitest-environment jsdom
/** The Claude Code page as the Plugins page renders it: its one-liner and its Ultracode switch. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { ClaudeCodeCard, type ClaudeCodeCardProps } from '../src/client/ClaudeCodeCard.tsx'
import type { ClaudeCodeCardState } from '../src/client/claude-code-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const settled: SettingsFormShell = { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }

function field(text: string, rest: Partial<SettingsFieldState> = {}): SettingsFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

function renderCard(state: Partial<ClaudeCodeCardState> = {}, view: 'summary' | 'page' = 'page') {
  const store = createSnapshotStore<ClaudeCodeCardState>({ ...settled, ultracode: field('false'), ...state })
  const actions = { edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn() }
  const props = { ...actions, view, t, useClaudeCodeCard: bindSnapshotSelector(store) } as ClaudeCodeCardProps
  render(<ClaudeCodeCard {...props} />)
  return actions
}

describe('ClaudeCodeCard', () => {
  it('renders its one-liner alone in the summary view', () => {
    renderCard({}, 'summary')

    expect(document.body.textContent).toBe(en.claudeCodeDescription)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('stages the Ultracode switch and saves it', () => {
    const actions = renderCard({ dirty: true })

    fireEvent.click(screen.getByRole('switch', { name: en.ultracodeLabel }))
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    expect(actions.edit).toHaveBeenCalledWith('ultracode', 'true')
    expect(actions.save).toHaveBeenCalledOnce()
  })

  it('shows a stored Ultracode as on and offers a reset back to the Claude Code default', () => {
    const actions = renderCard({ ultracode: field('true', { overridden: true }) })

    expect(screen.getByRole('switch', { name: en.ultracodeLabel }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: en.reset }))

    expect(actions.resetField).toHaveBeenCalledWith('ultracode')
  })

  it('says Claude Code decides while no Ultracode is stored', () => {
    renderCard({ ultracode: field('false') })

    expect(screen.getByText(en.ultracodeUnset)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.reset })).toBeNull()
  })

  it('says the plugin is not loaded while its namespace is unavailable, and disables the switch while the document is read-only', () => {
    renderCard({ available: false })
    expect(screen.getByRole('status').textContent).toBe(en.unavailable)
    cleanup()

    renderCard({ writable: false })
    expect(screen.getByRole('status').textContent).toBe(en.readOnly)
    expect(screen.getByRole('switch', { name: en.ultracodeLabel })).toHaveProperty('disabled', true)
  })
})
