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

describe('HooksSettingsSection search and location', () => {
  const searchable: Snapshot = {
    entries: [],
    hooks: [
      {
        dialect: 'codex', source: '/home/me/.codex/hooks.json', status: 'loaded', settingsNs: 'hooks-codex', skipped: [],
        handlers: [
          { event: 'PreToolUse', matcher: 'Write', command: 'node "/h/guard.mjs"', key: 'k1' },
          { event: 'Stop', command: 'node "/h/notify.mjs"', key: 'k2', description: 'Pings my phone' },
        ],
      },
      {
        dialect: 'claude-code', source: '/home/me/.claude/settings.json', status: 'loaded', settingsNs: 'hooks-claude', skipped: [],
        handlers: [{ event: 'SessionStart', command: 'bash /h/boot.sh', key: 'k3' }],
      },
    ],
  }
  const names = (): string[] => screen.getAllByRole('switch').map(item => item.getAttribute('aria-label') ?? '')
  const search = (value: string): void => {
    fireEvent.change(screen.getByRole('searchbox', { name: en.hooksSearch }), { target: { value } })
  }

  it('shows where each hook comes from without hovering', async () => {
    render(<HooksSettingsSection {...sectionProps(async () => searchable)} />)
    expect(await screen.findByText('/home/me/.codex/hooks.json')).toBeTruthy()
    expect(screen.getByText('/home/me/.claude/settings.json')).toBeTruthy()
    expect(screen.getByText('PreToolUse')).toBeTruthy()
    expect(screen.getByText('Write')).toBeTruthy()
    expect(screen.queryByText('node "/h/guard.mjs"')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: en.hooksDetails })[0]!)
    expect(screen.getByText('node "/h/guard.mjs"')).toBeTruthy()
  })

  it.each([
    ['notify', ['notify']],
    ['PRETOOLUSE', ['guard']],
    ['write', ['guard']],
    ['pings', ['notify']],
    ['boot.sh', ['boot']],
    ['.codex', ['guard', 'notify']],
    ['claude-code', ['boot']],
  ])('narrows the list for %j', async (query, expected) => {
    render(<HooksSettingsSection {...sectionProps(async () => searchable)} />)
    await screen.findByRole('searchbox', { name: en.hooksSearch })
    search(query)
    expect(names()).toEqual(expected.map(name => `${en.hooksToggle}: ${name}`))
  })

  it('hides empty sources and the bulk buttons while searching, and restores them when cleared', async () => {
    render(<HooksSettingsSection {...sectionProps(async () => searchable)} />)
    await screen.findByRole('searchbox', { name: en.hooksSearch })
    expect(screen.getAllByRole('button', { name: en.hooksDisableAll })).toHaveLength(2)
    search('boot')
    expect(screen.queryByText('/home/me/.codex/hooks.json')).toBeNull()
    expect(screen.queryByRole('button', { name: en.hooksDisableAll })).toBeNull()
    search('  ')
    expect(names()).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: en.hooksDisableAll })).toHaveLength(2)
  })

  it('says so when nothing matches', async () => {
    render(<HooksSettingsSection {...sectionProps(async () => searchable)} />)
    await screen.findByRole('searchbox', { name: en.hooksSearch })
    search('no-such-hook')
    expect(screen.getByText(en.hooksEmptySearch)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('offers no search box when there is nothing to search', async () => {
    const empty: Snapshot = { entries: [], hooks: [] }
    render(<HooksSettingsSection {...sectionProps(async () => empty)} />)
    expect(await screen.findByText(en.hooksEmpty)).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})

describe('HooksSettingsSection audit regressions', () => {
  it('shows external commands, read failures and skipped entries as read-only sources', async () => {
    const external: Snapshot = {
      entries: [],
      hooks: [
        {
          dialect: 'claude-code', source: '/home/me/.claude/settings.json', status: 'configured', skipped: ['Stop: http'],
          handlers: [{ event: 'Stop', command: 'node "/h/notify.mjs"', key: 'x1' }],
        },
        { dialect: 'codex', source: '/home/me/.codex/hooks.json', status: 'failed', handlers: [], skipped: [], error: 'Invalid hook JSON' },
      ],
    }
    render(<HooksSettingsSection {...sectionProps(async () => external)} />)
    expect(await screen.findByText('/home/me/.claude/settings.json')).toBeTruthy()
    expect(screen.getByText(en.hooksConfigured)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Invalid hook JSON')
    expect(screen.queryByRole('switch')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.hooksDetails }))
    expect(screen.getByText('node "/h/notify.mjs"')).toBeTruthy()
    expect(screen.getByText(/Stop: http/)).toBeTruthy()
  })

  it('gives each distinct command its own switch', async () => {
    const separate: Snapshot = {
      entries: [],
      hooks: [{
        dialect: 'claude-code', source: '/home/me/.claude/settings.json', status: 'loaded', settingsNs: 'hooks-claude', skipped: [],
        handlers: [
          { event: 'PreToolUse', matcher: 'Bash', command: 'npx prettier --check', key: 'p1' },
          { event: 'Stop', command: 'npx eslint .', key: 'e1' },
        ],
      }],
    }
    render(<HooksSettingsSection {...sectionProps(async () => separate)} />)
    await screen.findAllByRole('switch')
    expect(screen.getAllByRole('switch')).toHaveLength(2)
  })

  it('opens the description editor for one bridge only when two bridges share a dialect and hook name', async () => {
    const shared: Snapshot = {
      entries: [],
      hooks: [
        {
          dialect: 'codex', source: '/a/hooks.json', status: 'loaded', settingsNs: 'hooks-a', skipped: [],
          handlers: [{ event: 'Stop', command: 'node "/a/guard.mjs"', key: 'a1', description: 'Blocks writes' }],
        },
        {
          dialect: 'codex', source: '/b/hooks.json', status: 'loaded', settingsNs: 'hooks-b', skipped: [],
          handlers: [{ event: 'Stop', command: 'node "/b/guard.mjs"', key: 'b1', description: 'Blocks writes' }],
        },
      ],
    }
    render(<HooksSettingsSection {...sectionProps(async () => shared)} />)
    fireEvent.click((await screen.findAllByRole('button', { name: en.hooksDescriptionEdit }))[0]!)
    expect(screen.getAllByLabelText(`${en.hooksDescription}: guard`)).toHaveLength(1)
  })

  it('does not print an empty matcher as an empty parenthesis', async () => {
    const empty: Snapshot = {
      entries: [],
      hooks: [{
        dialect: 'claude-code', source: '/s.json', status: 'loaded', settingsNs: 'hooks-c', skipped: [],
        handlers: [{ event: 'Stop', matcher: '', command: 'node "/h/x.mjs"', key: 'z1' }],
      }],
    }
    render(<HooksSettingsSection {...sectionProps(async () => empty)} />)
    await screen.findByRole('switch')
    expect(screen.queryByText(/\(\)/)).toBeNull()
  })
})
