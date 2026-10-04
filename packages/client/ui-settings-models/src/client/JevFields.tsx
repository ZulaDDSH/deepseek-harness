/** The Jev router's settings and route rows inside its provider card. */
import type { ReactNode } from 'react'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { ModelPickerOption } from './ProviderEditor.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

type Route = Record<string, unknown>
type Draft = Record<string, unknown>
type LocaleKey = keyof typeof en

/**
 * The editable fields of one Jev route in render order, each paired with the
 * locale key naming it. A `Map` rather than an object literal because a
 * `description` row there reads as unlocalized product copy to the
 * client-i18n gate, which cannot tell a locale key from the copy itself.
 */
const JEV_ROUTE_FIELDS = new Map([
  ['provider', 'jevRouteProvider'],
  ['model', 'jevRouteModel'],
  ['id', 'jevRouteId'],
  ['description', 'jevRouteDescription'],
  ['reasoningEffort', 'jevRouteReasoningEffort'],
] as const)

const CUSTOM_CHOICE = '__custom__'
const KEEP = 'keep'

/** Props of {@link JevFields}. */
export interface JevFieldsProps {
  schema: SettingsSchemaOperations
  draft: Draft
  stored: unknown
  setDraft: (update: (current: Draft) => Draft) => void
  setField: (key: string, next: string | undefined) => void
  disabled: boolean
  ownProvider: string
  providers: readonly ModelPickerOption[]
  customFields: ReadonlySet<string>
  setCustomFields: (update: (fields: ReadonlySet<string>) => ReadonlySet<string>) => void
  t: (key: LocaleKey) => string
}

/** A route id derived from a model name: lowercase words joined by dashes. */
export function routeIdFor(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** The first of `base`, `base-2`, `base-3`… that no other route uses. */
function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}-${String(suffix)}`)) suffix += 1
  return `${base}-${String(suffix)}`
}

function text(route: Route, key: string): string {
  const value = route[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Render the Jev settings with an explanation under each one, and the route
 * rows, whose ID is set from the chosen model and can then be renamed.
 * @param props Draft, schema operations, model catalog and copy.
 * @returns The Jev fields.
 */
export function JevFields(props: JevFieldsProps): ReactNode {
  const { schema, draft, stored, setDraft, setField, disabled, providers, customFields, setCustomFields, t } = props
  const effective = (key: string): unknown => schema.getPath(draft, [key]) ?? schema.getPath(stored, [key])
  const textValue = (key: string, defaultValue: string): string => {
    const value = effective(key)
    return typeof value === 'string' ? value : defaultValue
  }
  const numberValue = (key: string, defaultValue: number): number => {
    const value = effective(key)
    return typeof value === 'number' ? value : defaultValue
  }
  const booleanValue = (key: string, defaultValue: boolean): boolean => {
    const value = effective(key)
    return typeof value === 'boolean' ? value : defaultValue
  }
  const setNumber = (key: string, value: string): void => {
    const parsed = value.trim().length === 0 ? Number.NaN : Number(value)
    setDraft(current => Number.isFinite(parsed) ? schema.setPath(current, [key], parsed) : schema.deletePath(current, [key]))
  }
  const routeSource = effective('routes')
  const routes: Route[] = Array.isArray(routeSource)
    ? routeSource.filter((route): route is Route => typeof route === 'object' && route !== null && !Array.isArray(route))
      .map(route => ({ ...route }))
    : []
  const fallback = textValue('fallback', KEEP)
  const setRoutes = (next: Route[], nextFallback = fallback): void => {
    setDraft((current) => {
      const withRoutes = schema.setPath(current, ['routes'], next)
      return nextFallback === fallback ? withRoutes : schema.setPath(withRoutes, ['fallback'], nextFallback)
    })
  }
  const updateRoute = (index: number, key: string, value: string | undefined): void => {
    const before = routes[index]
    /* v8 ignore next -- rows render from `routes`, so every index addresses one */
    if (before === undefined) return
    let after: Route = value === undefined ? schema.deletePath(before, [key]) : { ...before, [key]: value }
    const oldId = text(before, 'id')
    if (key === 'model' && value !== undefined) {
      const taken = new Set(routes.filter((_, other) => other !== index).map(route => text(route, 'id')))
      const derived = routeIdFor(value)
      after = { ...after, id: derived === '' ? '' : uniqueId(derived, taken) }
    }
    const newId = text(after, 'id')
    setRoutes(routes.map((route, other) => other === index ? after : route), fallback === oldId && oldId !== '' ? newId || KEEP : fallback)
  }
  const removeRoute = (index: number, removed: string): void => {
    setRoutes(routes.filter((_, other) => other !== index), fallback === removed ? KEEP : fallback)
  }
  const hint = (id: string, key: LocaleKey): ReactNode => <p id={`${id}-hint`} className={styles['advancedHint']}>{t(key)}</p>
  const textSetting = (labelKey: LocaleKey, hintKey: LocaleKey, fieldKey: string, defaultValue: string): ReactNode => (
    <div className={styles['field']} key={fieldKey}>
      <label className={styles['fieldLabel']} htmlFor={`jev-${fieldKey}`}>{t(labelKey)}</label>
      <input
        id={`jev-${fieldKey}`} className={styles['input']} type="text" value={textValue(fieldKey, defaultValue)}
        aria-label={t(labelKey)} aria-describedby={`jev-${fieldKey}-hint`} disabled={disabled}
        onChange={(event) => { setField(fieldKey, event.target.value) }}
      />
      {hint(`jev-${fieldKey}`, hintKey)}
    </div>
  )
  const numberSetting = (
    labelKey: LocaleKey, hintKey: LocaleKey, fieldKey: string, defaultValue: number, min: number, max?: number, step = 1,
  ): ReactNode => (
    <div className={styles['field']} key={fieldKey}>
      <label className={styles['fieldLabel']} htmlFor={`jev-${fieldKey}`}>{t(labelKey)}</label>
      <input
        id={`jev-${fieldKey}`} className={styles['input']} type="number" value={numberValue(fieldKey, defaultValue)}
        min={min} {...max === undefined ? {} : { max }} step={step}
        aria-label={t(labelKey)} aria-describedby={`jev-${fieldKey}-hint`} disabled={disabled}
        onChange={(event) => { setNumber(fieldKey, event.target.value) }}
      />
      {hint(`jev-${fieldKey}`, hintKey)}
    </div>
  )
  const toggle = (labelKey: LocaleKey, hintKey: LocaleKey, fieldKey: string, defaultValue: boolean): ReactNode => (
    <div className={styles['field']}>
      <label className={styles['fieldLabel']}>
        <input
          type="checkbox" checked={booleanValue(fieldKey, defaultValue)} aria-label={t(labelKey)}
          aria-describedby={`jev-${fieldKey}-hint`} disabled={disabled}
          onChange={(event) => { setDraft(current => schema.setPath(current, [fieldKey], event.target.checked)) }}
        />
        {t(labelKey)}
      </label>
      {hint(`jev-${fieldKey}`, hintKey)}
    </div>
  )
  const providerIds = [...new Set(providers.map(option => option.provider))].filter(provider => provider !== props.ownProvider)
  const providerNames = new Map(providers.map(option => [option.provider, option.displayName]))
  const routeIds = [...new Set(routes.map(route => text(route, 'id')).filter(id => id.length > 0))]
  const fallbackChoices = [...new Set([...routeIds, fallback].filter(id => id !== KEEP))]
  return (
    <div className={styles['customizedBody']}>
      {toggle('jevEnabled', 'jevEnabledHint', 'enabled', false)}
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('jevRoutes')}</span>
        {hint('jev-routes', 'jevRoutesHint')}
        <div className={styles['modelList']}>
          {routes.map((route, index) => {
            const selected = providers.find(option => option.provider === text(route, 'provider'))
            const effortIds = selected?.efforts?.[text(route, 'model')] ?? []
            return (
              <div className={styles['modelEntry']} key={index}>
                {[...JEV_ROUTE_FIELDS].map(([fieldKey, labelKey]) => {
                  const options = fieldKey === 'provider' ? providerIds
                    : fieldKey === 'model' ? selected?.models ?? []
                      : fieldKey === 'reasoningEffort' ? effortIds : undefined
                  const fieldId = `jev-route-${String(index)}-${fieldKey}`
                  const current = text(route, fieldKey)
                  const choices = options === undefined ? [] : [...new Set([...options, current].filter(value => value.length > 0))]
                  const asSelect = options !== undefined && !customFields.has(fieldId)
                  const label = `${t(labelKey)} ${String(index + 1)}`
                  const write = (value: string): void => {
                    updateRoute(index, fieldKey, fieldKey === 'reasoningEffort' && value === '' ? undefined : value)
                  }
                  return (
                    <div className={styles['modelField']} key={fieldKey}>
                      <label className={styles['modelFieldLabel']} htmlFor={fieldId}>{t(labelKey)}</label>
                      {asSelect ? (
                        <select
                          id={fieldId} className={`${styles['input']} ${styles['selectInput']}`} value={current}
                          aria-label={label} disabled={disabled}
                          onChange={(event) => {
                            const value = event.target.value
                            if (value === CUSTOM_CHOICE) setCustomFields(fields => new Set(fields).add(fieldId))
                            else write(value)
                          }}
                        >
                          <option value="">{t(fieldKey === 'reasoningEffort' ? 'jevRouteEffortDefault' : 'jevRouteChoose')}</option>
                          {choices.map(choice => (
                            <option key={choice} value={choice}>{fieldKey === 'provider' ? providerNames.get(choice) ?? choice : choice}</option>
                          ))}
                          <option value={CUSTOM_CHOICE}>{t('jevRouteCustom')}</option>
                        </select>
                      ) : (
                        <input
                          id={fieldId} className={styles['input']} type="text" value={current} aria-label={label}
                          placeholder={fieldKey === 'reasoningEffort' ? t('jevRouteReasoningEffortPlaceholder')
                            : fieldKey === 'description' ? t('jevRouteDescriptionPlaceholder') : undefined}
                          disabled={disabled}
                          onChange={(event) => { write(event.target.value) }}
                        />
                      )}
                    </div>
                  )
                })}
                <button
                  className={`${styles['iconButton']} ${styles['iconButtonDanger']}`} type="button" disabled={disabled}
                  aria-label={`${t('jevRemoveRoute')} ${String(index + 1)}`}
                  onClick={() => { removeRoute(index, text(route, 'id')) }}
                >
                  {t('jevRemoveRoute')}
                </button>
              </div>
            )
          })}
        </div>
        <button
          className={styles['addModelButton']} type="button" disabled={disabled}
          onClick={() => { setRoutes([...routes, { id: '', provider: '', model: '', description: '' }]) }}
        >
          {t('jevAddRoute')}
        </button>
      </div>
      <div className={styles['field']}>
        <label className={styles['fieldLabel']} htmlFor="jev-fallback">{t('jevFallback')}</label>
        <select
          id="jev-fallback" className={`${styles['input']} ${styles['selectInput']}`} value={fallback}
          aria-label={t('jevFallback')} aria-describedby="jev-fallback-hint" disabled={disabled}
          onChange={(event) => { setField('fallback', event.target.value) }}
        >
          <option value={KEEP}>{t('jevFallbackKeep')}</option>
          {fallbackChoices.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
        {hint('jev-fallback', 'jevFallbackHint')}
      </div>
      {toggle('jevFailOpen', 'jevFailOpenHint', 'failOpen', true)}
      {numberSetting('jevMinConfidence', 'jevMinConfidenceHint', 'minConfidence', 0.8, 0, 1, 0.01)}
      {numberSetting('jevTimeoutMs', 'jevTimeoutMsHint', 'timeoutMs', 1500, 1)}
      {numberSetting('jevStateMaxChars', 'jevStateMaxCharsHint', 'stateMaxChars', 12000, 256)}
      {textSetting('jevModel', 'jevModelHint', 'model', 'jev-latest')}
      {textSetting('jevEndpoint', 'jevEndpointHint', 'endpoint', 'https://api.typesafe.ai/v1/systemone')}
      {textSetting('jevApiKeyEnv', 'jevApiKeyEnvHint', 'apiKeyEnv', 'TYPESAFE_API_KEY')}
    </div>
  )
}
