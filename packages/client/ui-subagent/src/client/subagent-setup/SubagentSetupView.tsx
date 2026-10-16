import { useEffect, useId, useState } from 'react'
import type {
  ModelCatalog, ModelProviderGroup, SessionRunOptions, SessionRunOptionsProjection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type {
  SubagentGsdSetup, SubagentRoleRoute, SubagentRoleSetting, SubagentSetup,
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
  CLAUDE_CHOICE, DEFAULT_REVIEW_ROUNDS, JEV_CHOICE, NONE_CHOICE, catalogRoutesOf, choiceOf, defaultRolesFor,
  optionOf, settingOf, subagentSetupOrUndefined, withRole, withoutSubagentSetup,
} from './setup-model.ts'
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
  const claudeMissingModel = SUBAGENT_SETUP_ROLES.some((role) => {
    const setting = setup.roles[role]
    return setting?.mode === 'fixed' && setting.route.backend === 'claude-cli' && setting.route.model.trim() === ''
  })
  const workflowPrompt = subagentWorkflowPrompt(setup)

  const edit = (next: SubagentSetup): void => {
    setDraft(next)
    setFailure(undefined)
  }

  const setGsd = (patch: Partial<SubagentGsdSetup>): void => { edit({ ...setup, gsd: { ...gsd, ...patch } }) }

  const save = async (): Promise<void> => {
    setSaving(true)
    setFailure(undefined)
    const saveError = mode === 'global'
      ? await saveGlobal(setup)
      : await saveRunOptions({ ...(projection?.current ?? {}), subagentSetup: setup })
    setSaving(false)
    if (saveError !== undefined) setFailure(t('setup.saveError', { message: saveError }))
    else setDraft(undefined)
  }

  const saveAsGlobal = async (): Promise<void> => {
    setSaving(true)
    setFailure(undefined)
    const saveError = await saveGlobal(setup)
    setSaving(false)
    if (saveError !== undefined) setFailure(t('setup.saveError', { message: saveError }))
    else setDraft(undefined)
  }

  const resetToGlobal = async (): Promise<void> => {
    setSaving(true)
    setFailure(undefined)
    const saveError = await saveRunOptions(withoutSubagentSetup(projection?.current ?? {}))
    setSaving(false)
    if (saveError !== undefined) setFailure(t('setup.saveError', { message: saveError }))
    else setDraft(undefined)
  }

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
      <fieldset className={css.fieldset} disabled={readOnly}>
        <div className={css.enable}>
          <Switch
            checked={setup.enabled}
            onChange={(next) => { edit({ ...setup, enabled: next }) }}
            label={t('setup.enable')}
          />
          <span>{t('setup.enable')}</span>
        </div>
        {mode === 'session' && <p className={css.note}>{t(ultracode ? 'setup.ultracodeOn' : 'setup.ultracodeOff')}</p>}
        <div className={css.filter}>
          <label htmlFor={`${id}-provider`}>{t('filter.label')}</label>
          <select
            id={`${id}-provider`}
            className={css.select}
            value={providerFilter}
            onChange={(event) => { setProviderFilter(event.target.value) }}
          >
            <option value="">{t('filter.all')}</option>
            {pickableGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </div>
        {SUBAGENT_SETUP_ROLES.map((role) => {
          const setting: SubagentRoleSetting | undefined = setup.roles[role]
          const current = choiceOf(setting)
          const roleName = t(`role.${role}`)
          const route = setting?.mode === 'fixed' ? setting.route : undefined
          const listedGroups = pickableGroups.filter(group => providerFilter === ''
            || group.id === providerFilter
            || group.models.some(model => optionValueOf(group, model.id) === current))
          const stale = route?.backend === 'llm' && !routes.some(entry => entry.provider === route.provider && entry.model.id === route.model)
          const noCredential = route?.backend === 'llm' && groups.some(group => group.id === route.provider && group.missingCredential === true)
          const efforts = route === undefined ? []
            : route.backend === 'claude-cli'
              ? SESSION_RUN_OPTION_EFFORTS.map(level => ({ id: level, name: t(`effort.${level}`) }))
              : routes.find(entry => entry.provider === route.provider && entry.model.id === route.model)?.model.reasoning?.efforts ?? []
          return (
            <div key={role} className={css.row}>
              <label className={css.roleName} htmlFor={`${id}-${role}`}>{roleName}</label>
              <select
                id={`${id}-${role}`}
                className={css.select}
                value={current}
                onChange={(event) => { edit(withRole(setup, role, settingOf(event.target.value, setting))) }}
              >
                {role !== 'orchestrator' && <option value={NONE_CHOICE}>{t('choice.none')}</option>}
                <option value={JEV_CHOICE}>{t('choice.jev')}</option>
                {role !== 'orchestrator' && (claudeAvailable || route?.backend === 'claude-cli') && (
                  <option value={CLAUDE_CHOICE}>
                    {claudeAvailable ? t('choice.claude') : t('row.unavailable', { model: t('choice.claude') })}
                  </option>
                )}
                {listedGroups.map(group => (
                  <optgroup key={group.id} label={group.name}>
                    {group.models.map(model => (
                      <option key={model.id} value={optionValueOf(group, model.id)}>{model.name}</option>
                    ))}
                  </optgroup>
                ))}
                {route?.backend === 'llm' && stale && (
                  <option value={current}>
                    {catalogState === 'loading' ? route.model : t(noCredential ? 'row.noCredential' : 'row.unavailable', { model: route.model })}
                  </option>
                )}
              </select>
              {setting?.mode === 'jev' && <Tag tone="neutral">{t('row.jevControls')}</Tag>}
              {route?.backend === 'llm' && (
                <Tag tone="neutral">{groups.find(group => group.id === route.provider)?.name ?? route.provider}</Tag>
              )}
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
              {route !== undefined && efforts.length > 0 && (
                <select
                  className={css.select}
                  aria-label={t('row.effort', { role: roleName })}
                  value={route.reasoningEffort ?? ''}
                  onChange={(event) => { edit(withRole(setup, role, { mode: 'fixed', route: effortOf(route, event.target.value) })) }}
                >
                  <option value="">{t('effort.default')}</option>
                  {efforts.map(level => <option key={level.id} value={level.id}>{level.name}</option>)}
                </select>
              )}
            </div>
          )
        })}
        <div className={css.stepper}>
          <span>{t('setup.rounds')}</span>
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
        <fieldset className={css.group} disabled={!setup.enabled}>
          <legend>{t('gsd.group')}</legend>
          <p className={css.note}>{t('gsd.help')}</p>
          <p className={css.note}>{t('gsd.credit')}</p>
          {!setup.enabled && <p className={css.note}>{t('gsd.needsSubagent')}</p>}
          <div className={css.enable}>
            <Switch
              checked={gsd.enabled}
              onChange={(next) => { setGsd({ enabled: next }) }}
              label={t('gsd.enable')}
            />
            <span>{t('gsd.enable')}</span>
          </div>
          <div className={css.row}>
            <label className={css.roleName} htmlFor={`${id}-gsd-gates`}>{t('gsd.gates')}</label>
            <select
              id={`${id}-gsd-gates`}
              className={css.select}
              value={gsd.gates}
              onChange={(event) => {
                const gates = optionOf(GSD_GATES, event.target.value)
                if (gates !== undefined) setGsd({ gates })
              }}
            >
              {GSD_GATES.map(option => <option key={option} value={option}>{t(`gsd.gates.${option}`)}</option>)}
            </select>
          </div>
          <div className={css.row}>
            <label className={css.roleName} htmlFor={`${id}-gsd-plan`}>{t('gsd.planAuthor')}</label>
            <select
              id={`${id}-gsd-plan`}
              className={css.select}
              value={gsd.planAuthor}
              onChange={(event) => {
                const planAuthor = optionOf(GSD_PLAN_AUTHORS, event.target.value)
                if (planAuthor !== undefined) setGsd({ planAuthor })
              }}
            >
              {GSD_PLAN_AUTHORS.map(option => <option key={option} value={option}>{t(`gsd.planAuthor.${option}`)}</option>)}
            </select>
          </div>
          <div className={css.row}>
            <label className={css.roleName} htmlFor={`${id}-gsd-planning`}>{t('gsd.planning')}</label>
            <select
              id={`${id}-gsd-planning`}
              className={css.select}
              value={gsd.planning}
              onChange={(event) => {
                const planning = optionOf(GSD_PLANNING_MODES, event.target.value)
                if (planning !== undefined) setGsd({ planning })
              }}
            >
              {GSD_PLANNING_MODES.map(option => <option key={option} value={option}>{t(`gsd.planning.${option}`)}</option>)}
            </select>
          </div>
          <div className={css.stepper}>
            <span>{t('gsd.checkRounds')}</span>
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
          <div className={css.enable}>
            <Switch
              checked={gsd.parallelWaves}
              onChange={(next) => { setGsd({ parallelWaves: next }) }}
              label={t('gsd.parallelWaves')}
            />
            <span>{t('gsd.parallelWaves')}</span>
          </div>
        </fieldset>
      </fieldset>
      <section className={css.preview} aria-label={t('setup.preview')}>
        <strong>{t('setup.preview')}</strong>
        <p>{setup.enabled ? subagentPolicyPrompt(setup) : t('setup.previewOff')}</p>
        {workflowPrompt !== '' && <p>{workflowPrompt}</p>}
      </section>
      <div className={css.actions}>
        {dirty && <span className={css.note}>{t('setup.unsaved')}</span>}
        {claudeMissingModel && <span role="alert" className={css.note}>{t('setup.claudeModelMissing')}</span>}
        {failure !== undefined && <span role="alert" className={css.note}>{failure}</span>}
        <button type="button" disabled={draft === undefined || saving} onClick={() => { setDraft(undefined); setFailure(undefined) }}>
          {t('setup.discard')}
        </button>
        {mode === 'session' && (
          <button type="button" disabled={readOnly} onClick={() => { void saveAsGlobal() }}>
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
