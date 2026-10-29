// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  ModelCatalog, ModelProviderGroup, SessionRunOptions,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { subagentPolicyText, type SubagentSetup } from '@deepseek-ai/dsh-api-session-controller/client'
import { SubagentSetupView, type SubagentSetupViewProps } from '../src/client/subagent-setup/SubagentSetupView.tsx'
import { defaultRolesFor, withRole } from '../src/client/subagent-setup/setup-model.ts'
import { subagentWorkflowPrompt } from '../src/client/subagent-setup/contract.ts'
import { createClaudeServedFlag } from '../src/client/subagent-setup/global-setup.ts'
import { en, zh } from '../src/client/locales.ts'
import css from '../src/client/subagent-setup/SubagentSetup.module.css'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const groups: ModelProviderGroup[] = [{
  id: 'provider-a',
  name: 'Provider A',
  models: [
    { id: 'quick-flash', name: 'Quick Flash' },
    {
      id: 'deep-reasoner',
      name: 'Deep Reasoner',
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' },
    },
  ],
}]

const catalog: ModelCatalog = {
  default: { provider: 'provider-a', model: 'quick-flash' },
  routableProviders: ['provider-a'],
  groups,
  failures: [],
}

function t(key: string, params?: Record<string, unknown>): string {
  const template = (en as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function renderSetup(options: {
  current?: SessionRunOptions | null
  child?: boolean
  claude?: boolean
  catalog?: ModelCatalog
  global?: SubagentSetup
  mode?: 'session' | 'global'
  rejectSave?: boolean
} = {}) {
  const saveRunOptions = vi.fn(async (_options: SessionRunOptions) => {
    if (options.rejectSave === true) throw new Error('disk full')
    return undefined
  })
  const saveGlobal = vi.fn(async (_setup: SubagentSetup) => {
    if (options.rejectSave === true) throw new Error('disk full')
    return undefined
  })
  const loadCatalog = vi.fn(async () => options.catalog ?? catalog)
  const projection = { current: options.current === undefined ? null : options.current }
  const claudeCode = options.claude === true ? { available: true } : undefined
  const props: SubagentSetupViewProps = {
    t,
    useRunOptions: <R,>(select: (value: unknown) => R): R => select(projection),
    useClaudeCode: <R,>(select: (value: unknown) => R): R => select(claudeCode),
    useGlobalSetup: <R,>(select: (value: unknown) => R): R => select(options.global),
    mode: options.mode ?? 'session',
    child: options.child === true,
    loadCatalog,
    saveRunOptions,
    saveGlobal,
  }
  render(<SubagentSetupView {...props} />)
  return { saveRunOptions, saveGlobal, loadCatalog }
}

describe('defaultRolesFor', () => {
  it('picks coder and reviewer by catalog name, gives the reviewer high effort, and leaves the orchestrator to Jev', () => {
    expect(defaultRolesFor(groups)).toEqual({
      orchestrator: { mode: 'jev' },
      coder: { mode: 'fixed', route: { backend: 'llm', provider: 'provider-a', model: 'quick-flash' } },
      reviewer: {
        mode: 'fixed',
        route: { backend: 'llm', provider: 'provider-a', model: 'deep-reasoner', reasoningEffort: 'high' },
      },
    })
  })
})

describe('defaultRolesFor with the Claude CLI backend', () => {
  it('defaults the coder to Claude Haiku and the reviewer to Claude Opus', () => {
    expect(defaultRolesFor(groups, true)).toEqual({
      orchestrator: { mode: 'jev' },
      coder: { mode: 'fixed', route: { backend: 'claude-cli', model: 'haiku' } },
      reviewer: { mode: 'fixed', route: { backend: 'claude-cli', model: 'opus', reasoningEffort: 'high' } },
    })
  })

  it('falls back to Claude Sonnet when the Anthropic catalog lists no Opus', () => {
    const anthropic: ModelProviderGroup[] = [{ id: 'anthropic', name: 'Anthropic', models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet' }] }]
    expect(defaultRolesFor(anthropic, true).reviewer).toEqual({
      mode: 'fixed',
      route: { backend: 'claude-cli', model: 'sonnet', reasoningEffort: 'high' },
    })
  })

  it('keeps Claude Opus when the Anthropic catalog lists it', () => {
    const anthropic: ModelProviderGroup[] = [{ id: 'anthropic', name: 'Anthropic', models: [{ id: 'claude-opus-4-5', name: 'Claude Opus' }] }]
    expect(defaultRolesFor(anthropic, true).reviewer).toMatchObject({ route: { model: 'opus' } })
  })
})

describe('withRole', () => {
  it('clears one role without touching the others', () => {
    const setup: SubagentSetup = {
      enabled: true,
      reviewRounds: 0,
      roles: { orchestrator: { mode: 'jev' }, coder: { mode: 'jev' } },
    }
    expect(withRole(setup, 'coder', undefined).roles).toEqual({ orchestrator: { mode: 'jev' } })
  })
})

describe('SubagentSetupView', () => {
  it('saves the whole draft so Ultracode and effort survive the write', async () => {
    const { saveRunOptions } = renderSetup({ current: { ultracode: true, effort: 'high' } })
    fireEvent.click(screen.getByRole('switch', { name: en['setup.enable'] }))
    fireEvent.click(screen.getByRole('button', { name: en['setup.save'] }))
    await waitFor(() => { expect(saveRunOptions).toHaveBeenCalledTimes(1) })
    expect(saveRunOptions.mock.calls[0]?.[0]).toMatchObject({
      ultracode: true,
      effort: 'high',
      subagentSetup: { enabled: true },
    })
  })

  it('reports Ultracode as on only while the fixed orchestrator model supports it', async () => {
    const withCapable: ModelCatalog = {
      ...catalog,
      groups: [{ ...groups[0]!, models: [...groups[0]!.models, { id: 'capable', name: 'Capable', ultracode: true }] }],
    }
    const setupOn = (model: string): SessionRunOptions => ({
      ultracode: true,
      subagentSetup: { enabled: true, reviewRounds: 2, roles: { orchestrator: { mode: 'fixed', route: { backend: 'llm', provider: 'provider-a', model } } } },
    })
    renderSetup({ current: setupOn('quick-flash'), catalog: withCapable })
    expect(await screen.findByText(en['setup.ultracodeOff'])).toBeTruthy()
    cleanup()
    renderSetup({ current: setupOn('capable'), catalog: withCapable })
    expect(await screen.findByText(en['setup.ultracodeOn'])).toBeTruthy()
  })

  it('shows the Claude defaults on an unsaved setup when the Claude CLI backend is installed', () => {
    renderSetup({ claude: true })
    expect(screen.getByLabelText(t('claude.model', { role: en['role.coder'] }))).toHaveProperty('value', 'haiku')
    expect(screen.getByLabelText(t('claude.model', { role: en['role.reviewer'] }))).toHaveProperty('value', 'opus')
  })

  it('saves a fixed orchestrator route inside the setup only, without writing the Session model', async () => {
    const { saveRunOptions } = renderSetup({
      current: {
        subagentSetup: {
          enabled: false,
          reviewRounds: 2,
          roles: { orchestrator: { mode: 'fixed', route: { backend: 'llm', provider: 'provider-a', model: 'quick-flash' } } },
        },
      },
    })
    fireEvent.click(screen.getByRole('switch', { name: en['setup.enable'] }))
    fireEvent.click(screen.getByRole('button', { name: en['setup.save'] }))
    await waitFor(() => { expect(saveRunOptions).toHaveBeenCalledTimes(1) })
    expect(saveRunOptions.mock.lastCall?.[0].subagentSetup).toEqual({
      enabled: true,
      reviewRounds: 2,
      roles: { orchestrator: { mode: 'fixed', route: { backend: 'llm', provider: 'provider-a', model: 'quick-flash' } } },
    })
  })

  it('saves a disabled setup without touching the picked model', async () => {
    const { saveRunOptions } = renderSetup({
      current: {
        subagentSetup: {
          enabled: false,
          reviewRounds: 2,
          roles: { orchestrator: { mode: 'fixed', route: { backend: 'llm', provider: 'provider-a', model: 'quick-flash' } } },
        },
      },
    })
    fireEvent.click(screen.getByRole('button', { name: t('setup.roundsMore') }))
    fireEvent.click(screen.getByRole('button', { name: en['setup.save'] }))
    await waitFor(() => { expect(saveRunOptions).toHaveBeenCalledTimes(1) })
  })

  it('names the provider beside a fixed role route', async () => {
    renderSetup({
      current: {
        subagentSetup: {
          enabled: true,
          reviewRounds: 0,
          roles: { coder: { mode: 'fixed', route: { backend: 'llm', provider: 'provider-a', model: 'quick-flash' } } },
        },
      },
    })
    await screen.findAllByText('Quick Flash')
    expect(screen.getAllByText('Provider A').filter(element => element.tagName !== 'OPTION')).toHaveLength(1)
  })

  it('shows a saved route whose model left the catalog as unavailable', async () => {
    renderSetup({
      current: {
        subagentSetup: {
          enabled: true,
          reviewRounds: 0,
          roles: { coder: { mode: 'fixed', route: { backend: 'llm', provider: 'provider-a', model: 'retired-model' } } },
        },
      },
    })
    expect(await screen.findByText(t('row.unavailable', { model: 'retired-model' }))).toBeTruthy()
  })

  it('marks a saved route on a provider with no credential and keeps that provider out of new picks', async () => {
    const billed: ModelCatalog = {
      default: { provider: 'provider-a', model: 'quick-flash' },
      routableProviders: ['provider-a', 'provider-b'],
      groups: [...groups, {
        id: 'provider-b',
        name: 'Provider B',
        models: [{ id: 'billed-model', name: 'Billed Model' }],
        missingCredential: true,
      }],
      failures: [],
    }
    renderSetup({
      catalog: billed,
      current: {
        subagentSetup: {
          enabled: true,
          reviewRounds: 0,
          roles: { coder: { mode: 'fixed', route: { backend: 'llm', provider: 'provider-b', model: 'billed-model' } } },
        },
      },
    })
    expect(await screen.findByText(t('row.noCredential', { model: 'billed-model' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('combobox', { name: en['role.reviewer'] }))
    expect(screen.queryByRole('option', { name: 'Billed Model' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Quick Flash' })).toBeTruthy()
  })

  it('locks every control on a child session and names the top-level session', () => {
    renderSetup({ child: true, current: {} })
    expect(screen.getByText(en['setup.childNote'])).toBeTruthy()
    expect(screen.getByRole('switch', { name: en['setup.enable'] }).closest('fieldset')?.disabled).toBe(true)
  })

  it('previews the policy text the saved setup adds to the prompt', () => {
    const setup: SubagentSetup = { enabled: true, reviewRounds: 1, roles: { orchestrator: { mode: 'jev' } } }
    renderSetup({ current: { subagentSetup: setup } })
    expect(screen.getByText(subagentPolicyText(setup))).toBeTruthy()
  })

  it('names the Claude Code role without a model in a red alert and disables both saves', () => {
    renderSetup({
      claude: true,
      current: { subagentSetup: { enabled: true, reviewRounds: 2, roles: { coder: { mode: 'fixed', route: { backend: 'claude-cli', model: '' } } } } },
    })
    fireEvent.click(screen.getByRole('switch', { name: en['setup.enable'] }))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(t('setup.claudeModelMissing', { roles: en['role.coder'] }))
    expect(alert.className).toBe(css.error)
    expect(screen.getByRole('button', { name: en['setup.save'] }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: en['setup.saveGlobal'] }).hasAttribute('disabled')).toBe(true)
  })

  it('re-enables the controls and shows the error when a save rejects', async () => {
    renderSetup({ current: {}, rejectSave: true })
    fireEvent.click(screen.getByRole('switch', { name: en['setup.enable'] }))
    fireEvent.click(screen.getByRole('button', { name: en['setup.save'] }))
    expect(await screen.findByText(t('setup.saveError', { message: 'disk full' }))).toBeTruthy()
    expect(screen.getByRole('switch', { name: en['setup.enable'] }).closest('fieldset')?.disabled).toBe(false)
    expect(screen.getByRole('button', { name: en['setup.save'] }).hasAttribute('disabled')).toBe(false)
  })

  it('ignores a stored global default whose Claude Code role has no model', () => {
    renderSetup({
      claude: true,
      global: { enabled: true, reviewRounds: 4, roles: { coder: { mode: 'fixed', route: { backend: 'claude-cli', model: '' } } } },
    })
    expect(screen.getByRole('switch', { name: en['setup.enable'] }).getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('GSD workflow and global defaults in the Orchestrator & Subagent Setup View', () => {
  const on: SubagentSetup = { enabled: true, reviewRounds: 2, roles: {} }

  it('round-trips each GSD control through one save', async () => {
    const { saveRunOptions } = renderSetup({ current: { subagentSetup: on } })
    fireEvent.click(screen.getByRole('switch', { name: en['gsd.enable'] }))
    fireEvent.change(screen.getByLabelText(en['gsd.gates']), { target: { value: 'auto' } })
    fireEvent.change(screen.getByLabelText(en['gsd.planAuthor']), { target: { value: 'researcher' } })
    fireEvent.change(screen.getByLabelText(en['gsd.planning']), { target: { value: 'local' } })
    fireEvent.click(screen.getByRole('button', { name: en['gsd.checkRoundsMore'] }))
    fireEvent.click(screen.getByRole('switch', { name: en['gsd.parallelWaves'] }))
    fireEvent.click(screen.getByRole('button', { name: en['setup.save'] }))
    await waitFor(() => { expect(saveRunOptions).toHaveBeenCalledTimes(1) })
    expect(saveRunOptions.mock.calls[0]?.[0]).toMatchObject({
      subagentSetup: {
        enabled: true,
        gsd: { enabled: true, gates: 'auto', planAuthor: 'researcher', planning: 'local', checkRounds: 3, parallelWaves: false },
      },
    })
  })

  it('saves the auto responder switch with the setup, even while subagent mode is off', async () => {
    const { saveRunOptions } = renderSetup({ current: { subagentSetup: { ...on, enabled: false } } })
    const toggle = screen.getByRole('switch', { name: en['autoResponder.enable'] })
    expect(toggle.closest('fieldset')?.disabled).toBe(false)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: en['setup.save'] }))
    await waitFor(() => { expect(saveRunOptions).toHaveBeenCalledTimes(1) })
    expect(saveRunOptions.mock.calls[0]?.[0]).toMatchObject({ subagentSetup: { enabled: false, autoResponder: { enabled: true } } })
  })

  it('disables the GSD group while subagent mode is off', () => {
    renderSetup({ current: { subagentSetup: { ...on, enabled: false } } })
    expect(screen.getByLabelText(en['gsd.gates']).closest('fieldset')?.disabled).toBe(true)
    expect(screen.getByRole('switch', { name: en['gsd.enable'] }).closest('fieldset')?.disabled).toBe(true)
  })

  it('previews the GSD workflow text the saved setup adds to the prompt', () => {
    const setup: SubagentSetup = { ...on, gsd: { enabled: true, gates: 'every-step', planAuthor: 'orchestrator', planning: 'commit', checkRounds: 2, parallelWaves: true } }
    renderSetup({ current: { subagentSetup: setup } })
    expect(screen.getByText(subagentWorkflowPrompt(setup))).toBeTruthy()
  })

  it('shows a session with no override as using the global default, and a custom one as custom', () => {
    const global: SubagentSetup = { ...on, reviewRounds: 4 }
    const { saveRunOptions } = renderSetup({ current: null, global })
    expect(screen.getByText(en['scope.inherited'])).toBeTruthy()
    expect(screen.getByRole('switch', { name: en['setup.enable'] }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: en['setup.resetGlobal'] }).hasAttribute('disabled')).toBe(true)
    cleanup()
    renderSetup({ current: { subagentSetup: { ...on, reviewRounds: 1 } }, global })
    expect(screen.getByText(en['scope.custom'])).toBeTruthy()
    expect(saveRunOptions).not.toHaveBeenCalled()
  })

  it('resets a session to the global default by removing its override and keeping the other run options', async () => {
    const { saveRunOptions } = renderSetup({ current: { ultracode: true, effort: 'high', subagentSetup: on } })
    fireEvent.click(screen.getByRole('button', { name: en['setup.resetGlobal'] }))
    await waitFor(() => { expect(saveRunOptions).toHaveBeenCalledTimes(1) })
    const written = saveRunOptions.mock.calls[0]?.[0] as SessionRunOptions
    expect(written).toEqual({ ultracode: true, effort: 'high' })
    expect(written).not.toHaveProperty('subagentSetup')
  })

  it('saves the session setup as the global default without writing the session override', async () => {
    const { saveRunOptions, saveGlobal } = renderSetup({ current: { subagentSetup: { ...on, reviewRounds: 3 } } })
    fireEvent.click(screen.getByRole('button', { name: en['setup.saveGlobal'] }))
    await waitFor(() => { expect(saveGlobal).toHaveBeenCalledTimes(1) })
    expect(saveGlobal.mock.calls[0]?.[0]).toMatchObject({ enabled: true, reviewRounds: 3 })
    expect(saveRunOptions).not.toHaveBeenCalled()
  })

  it('edits the global default in global mode through the global write only', async () => {
    const { saveRunOptions, saveGlobal } = renderSetup({ mode: 'global', current: null })
    expect(screen.queryByText(en['scope.inherited'])).toBeNull()
    expect(screen.queryByRole('button', { name: en['setup.saveGlobal'] })).toBeNull()
    expect(screen.queryByRole('button', { name: en['setup.resetGlobal'] })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: en['setup.enable'] }))
    fireEvent.click(screen.getByRole('button', { name: en['setup.save'] }))
    await waitFor(() => { expect(saveGlobal).toHaveBeenCalledTimes(1) })
    expect(saveGlobal.mock.calls[0]?.[0]).toMatchObject({ enabled: true })
    expect(saveRunOptions).not.toHaveBeenCalled()
  })

  it('shows the per-session Ultracode note in a session panel but not in the global editor', () => {
    renderSetup({ current: {} })
    expect(screen.getByText(en['setup.ultracodeOff'])).toBeTruthy()
    cleanup()
    renderSetup({ mode: 'global' })
    expect(screen.queryByText(en['setup.ultracodeOff'])).toBeNull()
  })

  it('titles the global editor as the Settings page and says sessions inherit it, and only the session tab has no title', () => {
    const { loadCatalog } = renderSetup({ mode: 'global' })
    expect(screen.getByRole('heading', { name: en['global.title'] })).toBeTruthy()
    expect(screen.getByText(en['global.intro'])).toBeTruthy()
    expect(screen.getByRole('switch', { name: en['setup.enable'] })).toBeTruthy()
    expect(loadCatalog).toHaveBeenCalled()
    cleanup()
    renderSetup({ current: {} })
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByText(en['global.intro'])).toBeNull()
  })

  it('does not claim a scope for a child session, which follows its top-level session', () => {
    renderSetup({ child: true, current: null })
    expect(screen.queryByText(en['scope.inherited'])).toBeNull()
    expect(screen.queryByText(en['scope.custom'])).toBeNull()
  })

  it('offers the Claude CLI role backend in global mode once the Claude Code settings namespace is served', () => {
    const flag = createClaudeServedFlag()
    const seen: unknown[] = []
    const stop = flag.subscribe(() => { seen.push(flag.getSnapshot()) })
    expect(flag.getSnapshot()).toBeUndefined()
    flag.set(true)
    flag.set(true)
    expect(flag.getSnapshot()).toBe(flag.getSnapshot())
    flag.set(false)
    stop()
    flag.set(true)
    expect(seen).toEqual([{ available: true }, undefined])
    renderSetup({ mode: 'global', claude: true })
    fireEvent.click(screen.getByRole('combobox', { name: en['role.coder'] }))
    expect(screen.getAllByRole('option', { name: en['choice.claude'] }).length).toBeGreaterThan(0)
    cleanup()
    renderSetup({ mode: 'global', claude: false })
    fireEvent.click(screen.getByRole('combobox', { name: en['role.coder'] }))
    expect(screen.queryAllByRole('option', { name: en['choice.claude'] })).toEqual([])
  })

  it('names the tab Orchestrator & Subagent Setup in both locales', () => {
    expect(en['setup.tab']).toBe('Orchestrator & Subagent Setup')
    expect(zh['setup.tab']).toBe('编排器与子代理设置')
  })

  it('titles the Settings page Orchestrator & Subagents, with searchable keywords in both locales', () => {
    expect(en['global.title']).toBe('Orchestrator & Subagents')
    expect(zh['global.title']).toBe('编排器与子代理')
    for (const word of ['orchestrator', 'subagent', 'gsd', 'defaults', 'coder', 'reviewer', 'researcher']) {
      expect(en['search.keywords']).toContain(word)
    }
    for (const word of ['编排器', '子代理', 'GSD', '默认', '编码者', '审查者', '研究者']) {
      expect(zh['search.keywords']).toContain(word)
    }
  })
})

describe('searchable role model picker', () => {
  const multi: ModelCatalog = {
    default: { provider: 'provider-a', model: 'quick-flash' },
    routableProviders: ['provider-a', 'provider-b'],
    groups: [...groups, { id: 'provider-b', name: 'Provider B', models: [{ id: 'sonnet-x', name: 'Sonnet Ten' }] }],
    failures: [],
  }
  const open = async (role: string) => {
    await screen.findAllByRole('combobox')
    fireEvent.click(screen.getByRole('combobox', { name: role }))
    return screen.getByPlaceholderText(en['picker.search'])
  }

  it('filters the options by model name, model id or provider name', async () => {
    renderSetup({ catalog: multi })
    const box = await open(en['role.coder'])
    fireEvent.change(box, { target: { value: 'sonnet' } })
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(option => option.textContent)).toEqual(['Sonnet Ten'])
    fireEvent.change(box, { target: { value: 'provider a' } })
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(option => option.textContent)).toEqual(['Quick Flash', 'Deep Reasoner'])
    fireEvent.change(box, { target: { value: 'nothing-here' } })
    expect(within(screen.getByRole('listbox')).queryAllByRole('option')).toEqual([])
    expect(screen.getByText(en['picker.empty'])).toBeTruthy()
  })

  it('picks with the keyboard and writes the same role shape as before', async () => {
    const { saveRunOptions } = renderSetup({ catalog: multi, current: {} })
    const box = await open(en['role.coder'])
    fireEvent.change(box, { target: { value: 'deep' } })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('combobox', { name: en['role.coder'] }).textContent).toContain('Deep Reasoner')
    fireEvent.click(screen.getByRole('button', { name: en['setup.save'] }))
    await waitFor(() => { expect(saveRunOptions).toHaveBeenCalledTimes(1) })
    expect(saveRunOptions.mock.calls[0]?.[0].subagentSetup?.roles.coder).toEqual({
      mode: 'fixed',
      route: { backend: 'llm', provider: 'provider-a', model: 'deep-reasoner' },
    })
  })

  it('closes on Escape without changing the choice', async () => {
    renderSetup({ catalog: multi, current: {} })
    const box = await open(en['role.coder'])
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('button', { name: en['setup.save'] }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps provider, model and effort for each role in one row', async () => {
    renderSetup({
      current: {
        subagentSetup: {
          enabled: true,
          reviewRounds: 0,
          roles: { reviewer: { mode: 'fixed', route: { backend: 'llm', provider: 'provider-a', model: 'deep-reasoner', reasoningEffort: 'high' } } },
        },
      },
    })
    const effort = await screen.findByLabelText(t('row.effort', { role: en['role.reviewer'] }))
    const row = screen.getByRole('combobox', { name: en['role.reviewer'] }).closest(`.${css.row}`)
    expect(row?.contains(effort)).toBe(true)
    expect(row?.textContent).toContain('Provider A')
  })
})

describe('settings filter', () => {
  it('shows only the rows that match and says so when none do', () => {
    renderSetup({ mode: 'global' })
    const filter = screen.getByRole('searchbox', { name: en['filter.settings'] })
    fireEvent.change(filter, { target: { value: 'review' } })
    expect(screen.getByRole('combobox', { name: en['role.reviewer'] })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: en['role.coder'] })).toBeNull()
    expect(screen.getByText(en['setup.rounds'])).toBeTruthy()
    expect(screen.queryByText(en['gsd.group'])).toBeNull()
    fireEvent.change(filter, { target: { value: 'zzz' } })
    expect(screen.getByText(t('filter.settingsEmpty', { query: 'zzz' }))).toBeTruthy()
    fireEvent.change(filter, { target: { value: 'responder' } })
    expect(screen.getByRole('switch', { name: en['autoResponder.enable'] })).toBeTruthy()
    expect(screen.queryByText(en['gsd.group'])).toBeNull()
    fireEvent.change(filter, { target: { value: 'gsd' } })
    expect(screen.getByText(en['gsd.group'])).toBeTruthy()
    expect(screen.getByLabelText(en['gsd.gates'])).toBeTruthy()
  })

  it('keeps unsaved edits while rows are filtered out', () => {
    renderSetup({ mode: 'global' })
    fireEvent.click(screen.getByRole('switch', { name: en['setup.enable'] }))
    fireEvent.change(screen.getByRole('searchbox', { name: en['filter.settings'] }), { target: { value: 'coder' } })
    expect(screen.queryByRole('switch', { name: en['setup.enable'] })).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: en['filter.settings'] }), { target: { value: '' } })
    expect(screen.getByRole('switch', { name: en['setup.enable'] }).getAttribute('aria-checked')).toBe('true')
  })
})
