import { useEffect, useState } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import type { PluginInventoryLocaleKey } from './locales.ts'
import { Button, IconSearchOutlineRegular, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './HooksSettingsSection.module.css'

type HookInventoryReport = NonNullable<PluginInventorySnapshot['hooks']>[number]
type HookHandler = HookInventoryReport['handlers'][number]

interface HookRow {
  readonly id: string
  readonly command: string
  readonly name: string
  readonly keys: readonly string[]
  readonly handlers: readonly HookHandler[]
  readonly on: boolean
  readonly description: string | undefined
}

export interface HooksSettingsSectionInjected extends Pick<PluginInventorySettingsTabInjected, 'list'> {
  setEnabledHooks: (entryId: string, keys: readonly string[]) => Promise<void>
  setHookDescriptions: (entryId: string, descriptions: Readonly<Record<string, string>>) => Promise<void>
}

export type HooksSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<HooksSettingsSectionInjected>

const DIALECT_LABEL: Record<HookInventoryReport['dialect'], PluginInventoryLocaleKey> = {
  codex: 'hooksDialectCodex',
  'claude-code': 'hooksDialectClaudeCode',
}

const MATCHERS_SHOWN = 3

/** Name a hook command by its script file's base name, else by its first word.
 * @param command The hook command line as configured.
 * @returns The name shown on the hook row.
 */
export function hookName(command: string): string {
  const words = command.split(/\s+/).map(word => word.replaceAll('"', '').replaceAll("'", ''))
  const [first = ''] = words
  const script = words.find(word => /\.(m?js|cjs|ts|sh|ps1|py|cmd|bat|exe)$/i.test(word)) ?? first
  return script.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
}

function matcherOf(handler: HookHandler): string | undefined {
  return handler.matcher === undefined || handler.matcher === '' ? undefined : handler.matcher
}

function matcherNames(matchers: readonly string[]): string[] {
  return [...new Set(matchers.flatMap(matcher => matcher.split('|').map(name => name.trim()).filter(name => name.length > 0)))]
}

function groupByCommand(handlers: readonly HookHandler[]): [string, HookHandler[]][] {
  const groups = new Map<string, HookHandler[]>()
  for (const handler of handlers) groups.set(handler.command, [...groups.get(handler.command) ?? [], handler])
  return [...groups]
}

/** Settings → Hooks: one card per hook source. Bridge-loaded commands get switches; external files are read-only.
 * @param props Locale, the inventory reader and the enable and description writers.
 * @returns The Hooks settings section.
 */
export function HooksSettingsSection({ t, list, setEnabledHooks, setHookDescriptions }: HooksSettingsSectionProps) {
  const [snapshot, setSnapshot] = useState<PluginInventorySnapshot>()
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState<string>()
  const [failure, setFailure] = useState<{ entryId: string; message: string }>()
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<{ id: string; draft: string }>()
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const [query, setQuery] = useState('')
  useEffect(() => {
    let current = true
    setFailed(false)
    void list().then((value) => { if (current) setSnapshot(value) }, () => { if (current) setFailed(true) })
    return () => { current = false }
  }, [list, revision])
  const save = (entryId: string, operation: Promise<void>): void => {
    setSaving(entryId)
    setFailure(undefined)
    void operation
      .catch((error: unknown) => { setFailure({ entryId, message: error instanceof Error ? error.message : String(error) }) })
      .finally(() => {
        setSaving(undefined)
        setRevision(value => value + 1)
      })
  }
  const write = (entryId: string, enabled: readonly string[]): void => { save(entryId, setEnabledHooks(entryId, enabled)) }
  const describe = (entryId: string, report: HookInventoryReport, keys: readonly string[], text: string): void => {
    const descriptions: Record<string, string> = {}
    for (const handler of report.handlers) {
      if (handler.description !== undefined && !keys.includes(handler.key)) descriptions[handler.key] = handler.description
    }
    if (text.trim().length > 0) for (const key of keys) descriptions[key] = text.trim()
    setEditing(undefined)
    save(entryId, setHookDescriptions(entryId, descriptions))
  }
  const toggleDetails = (id: string): void => {
    setExpanded(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id])
  }
  const reports = snapshot?.hooks ?? []
  const needle = query.trim().toLowerCase()
  const searching = needle.length > 0
  const enabledOf = (report: HookInventoryReport): string[] =>
    report.handlers.filter(handler => handler.disabled !== true).map(handler => handler.key)
  const rowsOf = (report: HookInventoryReport): HookRow[] => groupByCommand(report.handlers).map(([command, handlers]) => ({
    id: JSON.stringify([report.dialect, report.source, report.settingsNs ?? null, command]),
    command,
    name: hookName(command),
    keys: handlers.map(handler => handler.key),
    handlers,
    on: handlers.every(handler => handler.disabled !== true),
    description: handlers.find(handler => handler.description !== undefined)?.description,
  }))
  const matches = (report: HookInventoryReport, row: HookRow): boolean => !searching
    || [report.source, report.dialect, row.name, ...row.handlers.flatMap(handler =>
      [handler.event, matcherOf(handler) ?? '', handler.command, handler.description ?? ''])].join('\n').toLowerCase().includes(needle)
  const visible = reports.map((report) => {
    const all = rowsOf(report)
    return { report, all, rows: all.filter(row => matches(report, row)) }
  }).filter(({ rows }) => !searching || rows.length > 0)
  return <section className={css.page}>
    <header className={css.header}>
      <div className={css.heading}>
        <h2 className={css.title}>{t('hooksTitle')}</h2>
        <p className={css.help}>{t('hooksHelp')}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => { setRevision(value => value + 1) }}>{t('hooksRefresh')}</Button>
    </header>
    {failed ? <p role="alert" className={css.error}>{t('error')}</p> : snapshot === undefined ? <p className={css.muted}>{t('loading')}</p> : <>
      {reports.length === 0 ? <p className={css.muted}>{t('hooksEmpty')}</p> : <label className={css.search}>
        <IconSearchOutlineRegular aria-hidden="true" />
        <input
          type="search"
          className={css.field}
          value={query}
          placeholder={t('hooksSearch')}
          aria-label={t('hooksSearch')}
          onChange={(event) => { setQuery(event.currentTarget.value) }}
        />
      </label>}
      {reports.length > 0 && visible.length === 0 ? <p className={css.muted}>{t('hooksEmptySearch')}</p> : null}
      {visible.map(({ report, all, rows }) => {
        const entryId = report.settingsNs
        const enabledCount = all.filter(row => row.on).length
        const statusText = report.status === 'failed' ? t('hooksFailed') : entryId === undefined ? t('hooksConfigured') : undefined
        return <article key={JSON.stringify([report.dialect, report.source, entryId ?? null])} className={css.card}>
          <header className={css.cardHeader}>
            <div className={css.cardTitle}>
              <div className={css.nameLine}>
                <h3 className={css.cardName}>{t(DIALECT_LABEL[report.dialect])}</h3>
                {entryId === undefined || all.length === 0 ? null : <span className={css.count}>{t('hooksCount', { on: enabledCount, total: all.length })}</span>}
              </div>
              <span className={css.source} title={report.source}>{report.source}</span>
            </div>
            <div className={css.cardActions}>
              {entryId !== undefined && saving === entryId ? <span role="status" className={css.muted}>{t('hooksSaving')}</span> : null}
              {entryId === undefined || all.length === 0 || searching ? null : <>
                <Button variant="ghost" size="sm" disabled={saving !== undefined} onClick={() => { write(entryId, all.flatMap(row => row.keys)) }}>
                  {t('hooksEnableAll')}
                </Button>
                <Button variant="ghost" size="sm" disabled={saving !== undefined} onClick={() => { write(entryId, []) }}>
                  {t('hooksDisableAll')}
                </Button>
              </>}
            </div>
          </header>
          {statusText === undefined ? null : <p className={css.muted}>{statusText}</p>}
          {report.error === undefined ? null : <p role="alert" className={css.error}>{report.error}</p>}
          {entryId !== undefined && failure?.entryId === entryId ? <p role="alert" className={css.error}>{t('hooksWriteFailed')}: {failure.message}</p> : null}
          {report.skipped.length === 0 ? null : <p className={css.muted}>{t('hooksSkipped')}: {report.skipped.join(', ')}</p>}
          {rows.length === 0 && report.error === undefined && !searching ? <p className={css.muted}>{t('hooksNone')}</p> : null}
          {rows.map((row) => {
            const isOpen = expanded.includes(row.id)
            const matchers = [...new Set(row.handlers.flatMap(handler => matcherOf(handler) ?? []))]
            const names = matcherNames(matchers)
            const matcherText = [...names.slice(0, MATCHERS_SHOWN), ...names.length > MATCHERS_SHOWN
              ? [t('hooksMoreMatchers', { count: names.length - MATCHERS_SHOWN })] : []].join(', ')
            const events = [...new Set(row.handlers.map(handler => handler.event))]
            const editor = editing?.id === row.id && entryId !== undefined
            return <div key={row.id} className={css.row} data-readonly={entryId === undefined || undefined}>
              {entryId === undefined ? null : <Switch
                className={css.switch}
                checked={row.on}
                disabled={saving !== undefined}
                label={`${t('hooksToggle')}: ${row.name}`}
                onChange={(next) => {
                  const others = enabledOf(report).filter(key => !row.keys.includes(key))
                  write(entryId, next ? [...others, ...row.keys] : others)
                }}
              />}
              <div className={css.rowBody}>
                <div className={css.rowHead}>
                  <span className={css.name} title={row.command}>{row.name}</span>
                  <Button variant="ghost" size="sm" aria-expanded={isOpen} onClick={() => { toggleDetails(row.id) }}>{t('hooksDetails')}</Button>
                </div>
                {editor ? <form className={css.editor} onSubmit={(event) => {
                  event.preventDefault()
                  describe(entryId, report, row.keys, editing.draft)
                }}>
                  <input
                    className={css.field}
                    aria-label={`${t('hooksDescription')}: ${row.name}`}
                    value={editing.draft}
                    placeholder={t('hooksDescriptionPlaceholder')}
                    onChange={(event) => { setEditing({ id: row.id, draft: event.target.value }) }}
                  />
                  <Button type="submit" size="sm" variant="primary" disabled={saving !== undefined}>{t('hooksDescriptionSave')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(undefined) }}>{t('hooksDescriptionCancel')}</Button>
                </form> : entryId === undefined && row.description === undefined ? null : <div className={css.describe}>
                  <span className={row.description === undefined ? css.muted : css.text}>{row.description ?? t('hooksNoDescription')}</span>
                  {entryId === undefined ? null : <Button variant="ghost" size="sm" onClick={() => { setEditing({ id: row.id, draft: row.description ?? '' }) }}>
                    {t('hooksDescriptionEdit')}
                  </Button>}
                </div>}
                <div className={css.tags}>
                  {events.map(event => <span key={event} className={css.chip}>{event}</span>)}
                </div>
                {names.length === 0 ? null : <p className={css.matcher} title={matchers.join('\n')}>{matcherText}</p>}
                {isOpen ? <div className={css.details}>
                  <pre className={css.command}>{row.command}</pre>
                  {matchers.length === 0 ? null : <p className={css.muted}>{t('hooksMatcher')}: {matchers.join(', ')}</p>}
                </div> : null}
              </div>
            </div>
          })}
        </article>
      })}
    </>}
  </section>
}
