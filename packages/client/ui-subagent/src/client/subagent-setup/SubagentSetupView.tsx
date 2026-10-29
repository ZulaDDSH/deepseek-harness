import { useEffect, useId, useState } from 'react'
import type {
  ModelCatalog, ModelProviderGroup, SessionRunOptions, SessionRunOptionsProjection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type {
  SubagentGsdSetup, SubagentRoleRoute, SubagentRoleSetting, SubagentSetup, SubagentSetupRole,
} from '@deepseek-ai/dsh-api-session-controller/client'
import {
  GSD_CHECK_ROUNDS_MAX, GSD_DEFAULTS, GSD_GATES, GSD_PLAN_AUTHORS, GSD_PLANNING_MODES,
  SESSION_RUN_OPTION_EFFORTS, SUBAGENT_REVIEW_ROUNDS_MAX, SUBAGENT_SETUP_ROLES,
  subagentPolicyPrompt, subagentWorkflowPrompt,
} from './contract.ts'
import { Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from '../locales.ts'
import {
  CLAUDE_CHOICE, DEFAULT_REVIEW_ROUNDS, JEV_CHOICE, NONE_CHOICE, catalogRoutesOf, choiceOf, claudeRolesMissingModel,
  defaultRolesFor, optionOf, settingOf, subagentSetupOrUndefined, withRole, withoutSubagentSetup,
} from './setup-model.ts'
import { RoleModelPicker, type RolePickerOption } from './RoleModelPicker.tsx'
import css from './SubagentSetup.module.css'

/** Observable read of one Session projection, as the owner injects it. */
export interface SetupSource<T> {
  getSnapshot: () => T
  subscribe: (listener: () => void) => () => void
}

/** Business face the Orchestrator & Subagent Setup View receives from the Session or the Host settings that own it. */
export interface SubagentSetupViewInjected {
  hooks: {
    runOptions: SetupSource<unknown>
    claudeCode: SetupSource<unknown>
    globalSetup: SetupSource<unknown>
  }
  /** `session` edits one Session's override of the global default; `global` edits the default itself. */
  mode: 'session' | 'global'
  child: boolean
  loadCatalog: () => Promise<ModelCatalog | undefined>
  saveRunOptions: (options: SessionRunOptions) => Promise<string | undefined>
  saveGlobal: (setup: SubagentSetup) => Promise<string | undefined>
}

/** Full props of the Orchestrator & Subagent Setup View, in a session tab or the global Settings section. */
export type SubagentSetupViewProps = PropsLocale<typeof NS> & InjectFace<SubagentSetupViewInjected>

function effortOf(route: SubagentRoleRoute, effort: string): SubagentRoleRoute {
  if (route.backend === 'claude-cli') {
    const level = SESSION_RUN_OPTION_EFFORTS.find(candidate => candidate === effort)
    return { backend: 'claude-cli', model: route.model, ...level === undefined ? {} : { reasoningEffort: level } }
  }
  return {
    backend: 'llm',
    provider: route.provider,
    model: route.model,
    ...effort === '' ? {} : { reasoningEffort: effort },
  }
}

function optionValueOf(group: ModelProviderGroup, model: string): string {
  return JSON.stringify([group.id, model])
}

/**
 * Render one draft over the Session's override or the global default, saved as one write.
 * @param props - locale, injected projections and the Host writes.
 * @returns the setup panel.
 */
export function SubagentSetupView({
  t, useRunOptions, useClaudeCode, useGlobalSetup, mode, child, loadCatalog, saveRunOptions, saveGlobal,
}: SubagentSetupViewProps) {
  const id = useId()
  const projection = useRunOptions(value => value) as SessionRunOptionsProjection | undefined
  const claudeAvailable = useClaudeCode(value => value !== undefined)
  const globalSaved = subagentSetupOrUndefined(useGlobalSetup(value => value))
  const saved = mode === 'global' ? globalSaved : projection?.current?.subagentSetup
  const [catalog, setCatalog] = useState<ModelCatalog | undefined>()
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [providerFilter, setProviderFilter] = useState('')
  const [filterText, setFilterText] = useState('')
  const [draft, setDraft] = useState<SubagentSetup | undefined>()
  const [failure, setFailure] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    void loadCatalog().then((value) => {
      if (!live) return
      setCatalog(value)
      setCatalogState(value === undefined ? 'failed' : 'ready')
    }, () => { if (live) setCatalogState('failed') })
    return () => { live = false }
  }, [loadCatalog])

  const groups = catalog?.groups ?? []
  const routable = new Set<string>(catalog?.routableProviders ?? [])
  const pickableGroups = groups.filter(group => routable.has(group.id) && group.missingCredential !== true)
  const routes = catalogRoutesOf(pickableGroups)
  const setup: SubagentSetup = draft ?? saved ?? globalSaved ?? {
    enabled: false,
    reviewRounds: DEFAULT_REVIEW_ROUNDS,
    roles: defaultRolesFor(pickableGroups, claudeAvailable),
  }
  const dirty = draft !== undefined
  const gsd: SubagentGsdSetup = setup.gsd ?? { enabled: false, ...GSD_DEFAULTS }
  const orchestrator = setup.roles.orchestrator
  const orchestratorRoute = setup.enabled && orchestrator?.mode === 'fixed' && orchestrator.route.backend === 'llm' ? orchestrator.route : undefined
  const orchestratorCapable = catalogState === 'ready' && orchestratorRoute !== undefined
    ? groups.find(group => group.id === orchestratorRoute.provider)
      ?.models.find(model => model.id === orchestratorRoute.model)?.ultracode === true
    : undefined
  const ultracode = projection?.current?.ultracode === true && orchestratorCapable !== false
  const readOnly = child || saving
  const claudeMissingRoles = claudeRolesMissingModel(setup)
  const claudeMissingModel = claudeMissingRoles.length > 0
  const workflowPrompt = subagentWorkflowPrompt(setup)

  const words = filterText.toLowerCase().split(/\s+/u).filter(word => word !== '')
  const show = (...texts: string[]): boolean => {
    const haystack = texts.join(' ').toLowerCase()
    return words.every(word => haystack.includes(word))
  }
  const gsdAll = show(t('gsd.group'), t('gsd.help'))
  const gsdShow = (label: string): boolean => gsdAll || show(label)
  const gsdVisible = gsdAll || [t('gsd.enable'), t('gsd.gates'), t('gsd.planAuthor'), t('gsd.planning'), t('gsd.checkRounds'), t('gsd.parallelWaves')].some(label => show(label))
  const autoResponderVisible = show(t('autoResponder.group'), t('autoResponder.help'), t('autoResponder.enable'))
  const roleVisible = (role: SubagentSetupRole): boolean => {
    const route = setup.roles[role]?.mode === 'fixed' ? setup.roles[role].route : undefined
    const group = route?.backend === 'llm' ? groups.find(entry => entry.id === route.provider) : undefined
    const model = route === undefined ? '' : route.backend === 'llm'
      ? group?.models.find(entry => entry.id === route.model)?.name ?? route.model
      : route.model
    return show(t(`role.${role}`), group?.name ?? (route?.backend === 'llm' ? route.provider : ''), model)
  }
  const nothingShown = words.length > 0 && !gsdVisible && !autoResponderVisible
    && !show(t('setup.enable'), t('setup.ultracodeOn'), t('setup.ultracodeOff'), t('filter.label'), t('setup.rounds'))
    && !SUBAGENT_SETUP_ROLES.some(roleVisible)

  const edit = (next: SubagentSetup): void => {
    setDraft(next)
    setFailure(undefined)
  }

  const setGsd = (patch: Partial<SubagentGsdSetup>): void => { edit({ ...setup, gsd: { ...gsd, ...patch } }) }

  const persist = async (write: () => Promise<string | undefined>): Promise<void> => {
    setSaving(true)
    setFailure(undefined)
    try {
      const saveError = await write()
      if (saveError !== undefined) setFailure(t('setup.saveError', { message: saveError }))
      else setDraft(undefined)
    } catch (error) {
      setFailure(t('setup.saveError', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setSaving(false)
    }
  }

  const save = (): Promise<void> => persist(() => mode === 'global'
    ? saveGlobal(setup)
    : saveRunOptions({ ...(projection?.current ?? {}), subagentSetup: setup }))

  const saveAsGlobal = (): Promise<void> => persist(() => saveGlobal(setup))

  const resetToGlobal = (): Promise<void> => persist(() => saveRunOptions(withoutSubagentSetup(projection?.current ?? {})))

  return (
    <div className={css.root}>
      {mode === 'global' && (
        <>
          <h2 className={css.heading}>{t('global.title')}</h2>
          <p className={css.note}>{t('global.intro')}</p>
        </>
      )}
      {child && <p role="status" className={css.note}>{t('setup.childNote')}</p>}
      {catalogState === 'loading' && <p className={css.note}>{t('catalog.loading')}</p>}
      {catalogState === 'failed' && <p role="alert" className={css.note}>{t('catalog.error')}</p>}
      {mode === 'session' && !child && <p className={css.note}>{t(saved === undefined ? 'scope.inherited' : 'scope.custom')}</p>}
      <div className={css.searchRow}>
        <input
          type="search"
          className={css.filterInput}
          aria-label={t('filter.settings')}
          placeholder={t('filter.settingsPlaceholder')}
          value={filterText}
          onChange={(event) => { setFilterText(event.target.value) }}
        />
      </div>
      {nothingShown && <p role="status" className={css.note}>{t('filter.settingsEmpty', { query: filterText.trim() })}</p>}
      <fieldset className={css.fieldset} disabled={readOnly}>
        {show(t('setup.enable'), t('setup.ultracodeOn'), t('setup.ultracodeOff')) && (
          <>
            <div className={css.enable}>
              <Switch
                checked={setup.enabled}
                onChange={(next) => { edit({ ...setup, enabled: next }) }}
                label={t('setup.enable')}
              />
              <span>{t('setup.enable')}</span>
            </div>
            {mode === 'session' && <p className={css.note}>{t(ultracode ? 'setup.ultracodeOn' : 'setup.ultracodeOff')}</p>}
          </>
        )}
        {show(t('filter.label')) && (
          <div className={css.row}>
            <label className={css.roleName} htmlFor={`${id}-provider`}>{t('filter.label')}</label>
            <select
              id={`${id}-provider`}
              className={css.control}
              value={providerFilter}
              onChange={(event) => { setProviderFilter(event.target.value) }}
            >
              <option value="">{t('filter.all')}</option>
              {pickableGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </div>
        )}
        {SUBAGENT_SETUP_ROLES.map((role) => {
          const setting: SubagentRoleSetting | undefined = setup.roles[role]
          const current = choiceOf(setting)
          const roleName = t(`role.${role}`)
          const route = setting?.mode === 'fixed' ? setting.route : undefined
          const providerName = route?.backend === 'llm' ? groups.find(group => group.id === route.provider)?.name ?? route.provider : ''
          const listedGroups = pickableGroups.filter(group => providerFilter === ''
            || group.id === providerFilter
            || group.models.some(model => optionValueOf(group, model.id) === current))
          const stale = route?.backend === 'llm' && !routes.some(entry => entry.provider === route.provider && entry.model.id === route.model)
          const noCredential = route?.backend === 'llm' && groups.some(group => group.id === route.provider && group.missingCredential === true)
          const efforts = route === undefined ? []
            : route.backend === 'claude-cli'
              ? SESSION_RUN_OPTION_EFFORTS.map(level => ({ id: level, name: t(`effort.${level}`) }))
              : routes.find(entry => entry.provider === route.provider && entry.model.id === route.model)?.model.reasoning?.efforts ?? []
          const options: RolePickerOption[] = [
            ...role !== 'orchestrator' ? [{ value: NONE_CHOICE, label: t('choice.none') }] : [],
            { value: JEV_CHOICE, label: t('choice.jev') },
            ...role !== 'orchestrator' && (claudeAvailable || route?.backend === 'claude-cli')
              ? [{
                value: CLAUDE_CHOICE,
                label: claudeAvailable ? t('choice.claude') : t('row.unavailable', { model: t('choice.claude') }),
                keywords: 'claude code anthropic subscription',
              }]
              : [],
            ...listedGroups.flatMap(group => group.models.map(model => ({
              value: optionValueOf(group, model.id),
              label: model.name,
              group: group.name,
              keywords: `${model.id} ${group.id}`,
            }))),
            ...route?.backend === 'llm' && stale
              ? [{
                value: current,
                label: catalogState === 'loading' ? route.model : t(noCredential ? 'row.noCredential' : 'row.unavailable', { model: route.model }),
                group: providerName,
                keywords: route.model,
              }]
              : [],
          ]
          if (!roleVisible(role)) return null
          return (
            <div key={role} className={css.row}>
              <label className={css.roleName} htmlFor={`${id}-${role}`}>{roleName}</label>
              <RoleModelPicker
                id={`${id}-${role}`}
                label={roleName}
                value={current}
                options={options}
                searchPlaceholder={t('picker.search')}
                emptyText={t('picker.empty')}
                onChange={(choice) => { edit(withRole(setup, role, settingOf(choice, setting))) }}
              />
              <div className={css.detail}>
                {setting?.mode === 'jev' && <Tag tone="neutral">{t('row.jevControls')}</Tag>}
                {route?.backend === 'llm' && <Tag tone="neutral">{providerName}</Tag>}
                {route?.backend === 'claude-cli' && (
                  <input
                    type="text"
                    className={css.input}
                    aria-label={t('claude.model', { role: roleName })}
                    placeholder={t('claude.modelPlaceholder')}
                    value={route.model}
                    onChange={(event) => { edit(withRole(setup, role, { mode: 'fixed', route: { ...route, model: event.target.value } })) }}
                  />
                )}
              </div>
              <div className={css.effort}>
                {route !== undefined && efforts.length > 0 && (
                  <select
                    className={css.control}
                    aria-label={t('row.effort', { role: roleName })}
                    value={route.reasoningEffort ?? ''}
                    onChange={(event) => { edit(withRole(setup, role, { mode: 'fixed', route: effortOf(route, event.target.value) })) }}
                  >
                    <option value="">{t('effort.default')}</option>
                    {efforts.map(level => <option key={level.id} value={level.id}>{level.name}</option>)}
                  </select>
                )}
              </div>
            </div>
          )
        })}
        {show(t('setup.rounds')) && (
          <div className={css.row}>
            <span className={css.roleName}>{t('setup.rounds')}</span>
            <div className={css.stepper}>
              <button
                type="button"
                aria-label={t('setup.roundsLess')}
                disabled={setup.reviewRounds <= 0}
                onClick={() => { edit({ ...setup, reviewRounds: setup.reviewRounds - 1 }) }}
              >
                −
              </button>
              <output aria-live="polite">{setup.reviewRounds}</output>
              <button
                type="button"
                aria-label={t('setup.roundsMore')}
                disabled={setup.reviewRounds >= SUBAGENT_REVIEW_ROUNDS_MAX}
                onClick={() => { edit({ ...setup, reviewRounds: setup.reviewRounds + 1 }) }}
              >
                +
              </button>
            </div>
          </div>
        )}
        {gsdVisible && (
          <fieldset className={css.group} disabled={!setup.enabled}>
            <legend>{t('gsd.group')}</legend>
            <p className={css.note}>{t('gsd.help')}</p>
            <p className={css.note}>{t('gsd.credit')}</p>
            {!setup.enabled && <p className={css.note}>{t('gsd.needsSubagent')}</p>}
            {gsdShow(t('gsd.enable')) && (
              <div className={css.enable}>
                <Switch
                  checked={gsd.enabled}
                  onChange={(next) => { setGsd({ enabled: next }) }}
                  label={t('gsd.enable')}
                />
                <span>{t('gsd.enable')}</span>
              </div>
            )}
            {gsdShow(t('gsd.gates')) && (
              <div className={css.row}>
                <label className={css.roleName} htmlFor={`${id}-gsd-gates`}>{t('gsd.gates')}</label>
                <select
                  id={`${id}-gsd-gates`}
                  className={css.control}
                  value={gsd.gates}
                  onChange={(event) => {
                    const gates = optionOf(GSD_GATES, event.target.value)
                    if (gates !== undefined) setGsd({ gates })
                  }}
                >
                  {GSD_GATES.map(option => <option key={option} value={option}>{t(`gsd.gates.${option}`)}</option>)}
                </select>
              </div>
            )}
            {gsdShow(t('gsd.planAuthor')) && (
              <div className={css.row}>
                <label className={css.roleName} htmlFor={`${id}-gsd-plan`}>{t('gsd.planAuthor')}</label>
                <select
                  id={`${id}-gsd-plan`}
                  className={css.control}
                  value={gsd.planAuthor}
                  onChange={(event) => {
                    const planAuthor = optionOf(GSD_PLAN_AUTHORS, event.target.value)
                    if (planAuthor !== undefined) setGsd({ planAuthor })
                  }}
                >
                  {GSD_PLAN_AUTHORS.map(option => <option key={option} value={option}>{t(`gsd.planAuthor.${option}`)}</option>)}
                </select>
              </div>
            )}
            {gsdShow(t('gsd.planning')) && (
              <div className={css.row}>
                <label className={css.roleName} htmlFor={`${id}-gsd-planning`}>{t('gsd.planning')}</label>
                <select
                  id={`${id}-gsd-planning`}
                  className={css.control}
                  value={gsd.planning}
                  onChange={(event) => {
                    const planning = optionOf(GSD_PLANNING_MODES, event.target.value)
                    if (planning !== undefined) setGsd({ planning })
                  }}
                >
                  {GSD_PLANNING_MODES.map(option => <option key={option} value={option}>{t(`gsd.planning.${option}`)}</option>)}
                </select>
              </div>
            )}
            {gsdShow(t('gsd.checkRounds')) && (
              <div className={css.row}>
                <span className={css.roleName}>{t('gsd.checkRounds')}</span>
                <div className={css.stepper}>
                  <button
                    type="button"
                    aria-label={t('gsd.checkRoundsLess')}
                    disabled={gsd.checkRounds <= 0}
                    onClick={() => { setGsd({ checkRounds: gsd.checkRounds - 1 }) }}
                  >
                    −
                  </button>
                  <output aria-live="polite">{gsd.checkRounds}</output>
                  <button
                    type="button"
                    aria-label={t('gsd.checkRoundsMore')}
                    disabled={gsd.checkRounds >= GSD_CHECK_ROUNDS_MAX}
                    onClick={() => { setGsd({ checkRounds: gsd.checkRounds + 1 }) }}
                  >
                    +
                  </button>
                </div>
              </div>
            )}
            {gsdShow(t('gsd.parallelWaves')) && (
              <div className={css.enable}>
                <Switch
                  checked={gsd.parallelWaves}
                  onChange={(next) => { setGsd({ parallelWaves: next }) }}
                  label={t('gsd.parallelWaves')}
                />
                <span>{t('gsd.parallelWaves')}</span>
              </div>
            )}
          </fieldset>
        )}
        {autoResponderVisible && (
          <fieldset className={css.group}>
            <legend>{t('autoResponder.group')}</legend>
            <p className={css.note}>{t('autoResponder.help')}</p>
            <div className={css.enable}>
              <Switch
                checked={setup.autoResponder?.enabled === true}
                onChange={(next) => { edit({ ...setup, autoResponder: { enabled: next } }) }}
                label={t('autoResponder.enable')}
              />
              <span>{t('autoResponder.enable')}</span>
            </div>
          </fieldset>
        )}
      </fieldset>
      <section className={css.preview} aria-label={t('setup.preview')}>
        <strong>{t('setup.preview')}</strong>
        <p>{setup.enabled ? subagentPolicyPrompt(setup) : t('setup.previewOff')}</p>
        {workflowPrompt !== '' && <p>{workflowPrompt}</p>}
      </section>
      <div className={css.actions}>
        {dirty && <span className={css.note}>{t('setup.unsaved')}</span>}
        {claudeMissingModel && (
          <span role="alert" className={css.error}>
            {t('setup.claudeModelMissing', { roles: claudeMissingRoles.map(role => t(`role.${role}`)).join(', ') })}
          </span>
        )}
        {failure !== undefined && <span role="alert" className={css.note}>{failure}</span>}
        <button type="button" disabled={draft === undefined || saving} onClick={() => { setDraft(undefined); setFailure(undefined) }}>
          {t('setup.discard')}
        </button>
        {mode === 'session' && (
          <button type="button" disabled={readOnly || claudeMissingModel} onClick={() => { void saveAsGlobal() }}>
            {t('setup.saveGlobal')}
          </button>
        )}
        {mode === 'session' && (
          <button type="button" disabled={readOnly || saved === undefined} onClick={() => { void resetToGlobal() }}>
            {t('setup.resetGlobal')}
          </button>
        )}
        <button type="button" disabled={!dirty || readOnly || claudeMissingModel} onClick={() => { void save() }}>
          {t('setup.save')}
        </button>
      </div>
    </div>
  )
}
