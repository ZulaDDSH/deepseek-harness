// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HooksSettingsSection, hookName } from '../src/client/HooksSettingsSection.tsx'
import type { HooksSettingsSectionProps } from '../src/client/HooksSettingsSection.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

type List = HooksSettingsSectionProps['list']
type Snapshot = Awaited<ReturnType<List>>

const t = ((key: PluginInventoryLocaleKey) => en[key]) as HooksSettingsSectionProps['t']

function sectionProps(list: List, setEnabledHooks = vi.fn(async () => {})): HooksSettingsSectionProps {
  return { t, list, setEnabledHooks, setHookDescriptions: vi.fn(async () => {}), close: () => {} } as HooksSettingsSectionProps
}

const loaded: Snapshot = {
  entries: [],
  hooks: [{
    dialect: 'codex', source: '/hooks.json', status: 'loaded', settingsNs: 'hooks-1', skipped: [],
    handlers: [{ event: 'Stop', command: 'one', key: 'k1' }],
  }],
}

describe('hookName', () => {
  it.each([
    ['node "C:/h/check-policy.mjs" --x', 'check-policy'],
    [String.raw`node "C:\hooks\check-policy.mjs" --x`, 'check-policy'],
    [String.raw`"D:\a\run.ps1"`, 'run'],
    ['node --flag', 'node'],
    ['', ''],
  ])('names %j as %j', (command, name) => {
    expect(hookName(command)).toBe(name)
  })
})

describe('HooksSettingsSection failures', () => {
  it('shows a generic error when the inventory cannot be read', async () => {
    const list = vi.fn<List>().mockRejectedValue(new Error('private transport detail'))
    render(<HooksSettingsSection {...sectionProps(list)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
  })

  it('ignores an inventory result that arrives after unmount', async () => {
    const resolved = Promise.withResolvers<Snapshot>()
    render(<HooksSettingsSection {...sectionProps(() => resolved.promise)} />).unmount()
    await act(async () => { resolved.resolve(loaded) })

    const rejected = Promise.withResolvers<Snapshot>()
    render(<HooksSettingsSection {...sectionProps(() => rejected.promise)} />).unmount()
    await act(async () => { rejected.reject(new Error('late failure')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports a write rejected with a non-Error value', async () => {
    const setEnabledHooks = vi.fn().mockRejectedValue('quota exceeded')
    render(<HooksSettingsSection {...sectionProps(async () => loaded, setEnabledHooks)} />)
    fireEvent.click(await screen.findByRole('button', { name: en.hooksDisableAll }))
    expect(await screen.findByText(`${en.hooksWriteFailed}: quota exceeded`)).toBeTruthy()
  })
})
