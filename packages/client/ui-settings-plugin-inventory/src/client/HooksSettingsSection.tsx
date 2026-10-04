import { useEffect, useState } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { Button, IconSearchOutlineRegular, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './PluginInventorySettingsTab.module.css'

type HookInventoryReport = NonNullable<PluginInventorySnapshot['hooks']>[number]

export interface HooksSettingsSectionInjected extends Pick<PluginInventorySettingsTabInjected, 'list'> {
  setEnabledHooks: (entryId: string, keys: readonly string[]) => Promise<void>
  setHookDescriptions: (entryId: string, descriptions: Readonly<Record<string, string>>) => Promise<void>
}

export type HooksSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<HooksSettingsSectionInjected>

export function hookName(command: string): string {
  const words = command.split(/\s+/).map(word => word.replaceAll('"', '').replaceAll("'", ''))
  const [first = ''] = words
  const script = words.find(word => /\.(m?js|cjs|ts|sh|ps1|py|cmd|bat|exe)$/i.test(word)) ?? first
  return script.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
}

type HookHandler = HookInventoryReport['handlers'][number]

function eventLabel(handler: HookHandler): string {
  return handler.matcher === undefined ? handler.event : `${handler.event} (${handler.matcher})`
}

function groupByScript(handlers: HookInventoryReport['handlers']): [string, HookInventoryReport['handlers']][] {
  const groups = new Map<string, HookHandler[]>()
  for (const handler of handlers) {
    const name = hookName(handler.command)
    groups.set(name, [...groups.get(name) ?? [], handler])
  }
  return [...groups]
}

export function HooksSettingsSection({ t, list, setEnabledHooks, setHookDescriptions }: HooksSettingsSectionProps) {
  const [snapshot, setSnapshot] = useState<PluginInventorySnapshot>()
  const [failed, setFailed] = useState(false)
  const [writeFailed, setWriteFailed] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<{ id: string; draft: string }>()
  const [query, setQuery] = useState('')
  useEffect(() => {
    let current = true
    setFailed(false)
    void list().then((value) => { if (current) setSnapshot(value) }, () => { if (current) setFailed(true) })
    return () => { current = false }
  }, [list, revision])
  const save = (operation: Promise<void>): void => {
    setBusy(true)
    setWriteFailed(undefined)
    void operation
      .catch((error: unknown) => { setWriteFailed(error instanceof Error ? error.message : String(error)) })
      .finally(() => {
        setBusy(false)
        setRevision(value => value + 1)
      })
  }
  const write = (entryId: string, enabled: readonly string[]): void => { save(setEnabledHooks(entryId, enabled)) }
  const describe = (entryId: string, report: HookInventoryReport, keys: readonly string[], text: string): void => {
    const descriptions: Record<string, string> = {}
    for (const handler of report.handlers) {
      if (handler.description !== undefined && !keys.includes(handler.key)) descriptions[handler.key] = handler.description
    }
    if (text.trim().length > 0) for (const key of keys) descriptions[key] = text.trim()
    setEditing(undefined)
    save(setHookDescriptions(entryId, descriptions))
  }
  const enabledOf = (report: HookInventoryReport): string[] =>
    report.handlers.filter(handler => handler.disabled !== true).map(handler => handler.key)
  const controlled = (snapshot?.hooks ?? []).flatMap(report =>
    report.settingsNs === undefined ? [] : [{ report, entryId: report.settingsNs }])
  const needle = query.trim().toLowerCase()
  const searching = needle.length > 0
  const matches = (report: HookInventoryReport, name: string, handlers: readonly HookHandler[]): boolean =>
    !searching || [report.source, report.dialect, name, ...handlers.flatMap(handler =>
      [eventLabel(handler), handler.command, handler.description ?? ''])].join('\n').toLowerCase().includes(needle)
  const visible = controlled
    .map(item => ({
      ...item,
      groups: groupByScript(item.report.handlers).filter(([name, handlers]) => matches(item.report, name, handlers)),
    }))
    .filter(item => !searching || item.groups.length > 0)
  return <section className={css.section}>
    <h2>{t('hooksTitle')}</h2>
    <p>{t('hooksHelp')}</p>
    <Button variant="outline" onClick={() => { setRevision(value => value + 1) }}>{t('hooksRefresh')}</Button>
    {writeFailed === undefined ? null : <p role="alert">{t('hooksWriteFailed')}: {writeFailed}</p>}
    {failed ? <p role="alert">{t('error')}</p> : snapshot === undefined ? <p>{t('loading')}</p> : <>
      {controlled.length === 0 ? <p>{t('hooksEmpty')}</p> : <label className={css.search}>
        <IconSearchOutlineRegular aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder={t('hooksSearch')}
          aria-label={t('hooksSearch')}
          onChange={(event) => { setQuery(event.currentTarget.value) }}
        />
      </label>}
      {controlled.length > 0 && visible.length === 0 ? <p>{t('hooksEmptySearch')}</p> : null}
      {visible.map(({ report, entryId, groups }, index) => {
        return <article key={index}>
          <h3>{report.dialect}</h3>
          <p className={css.hint}><code className={css.hookCommand}>{report.source}</code></p>
          {report.error === undefined ? null : <p role="alert">{report.error}</p>}
          {report.handlers.length > 0 && !searching ? <p>
            <Button variant="outline" disabled={busy} onClick={() => { write(entryId, report.handlers.map(handler => handler.key)) }}>
              {t('hooksEnableAll')}
            </Button>
            {' '}
            <Button variant="outline" disabled={busy} onClick={() => { write(entryId, []) }}>{t('hooksDisableAll')}</Button>
          </p> : null}
          <ul>{groups.map(([name, handlers]) => {
            const keys = handlers.map(handler => handler.key)
            const on = handlers.every(handler => handler.disabled !== true)
            const description = handlers.find(handler => handler.description !== undefined)?.description
            const id = `${report.dialect}/${name}`
            return <li key={name} title={[...new Set(handlers.map(handler => handler.command))].join('\n')}>
              <Switch
                checked={on}
                disabled={busy}
                label={`${t('hooksToggle')}: ${name}`}
                onChange={(next) => {
                  const others = enabledOf(report).filter(key => !keys.includes(key))
                  write(entryId, next ? [...others, ...keys] : others)
                }}
              />
              {' '}<strong>{name}</strong> — <small>{[...new Set(handlers.map(eventLabel))].join(', ')}</small>
              {[...new Set(handlers.map(handler => handler.command))].map(command =>
                <p key={command} className={css.hint}><code className={css.hookCommand}>{command}</code></p>)}
              {editing?.id === id
                ? <form onSubmit={(event) => { event.preventDefault(); describe(entryId, report, keys, editing.draft) }}>
                  <input
                    aria-label={`${t('hooksDescription')}: ${name}`}
                    value={editing.draft}
                    placeholder={t('hooksDescriptionPlaceholder')}
                    onChange={(event) => { setEditing({ id, draft: event.target.value }) }}
                  />
                  {' '}<Button type="submit" disabled={busy}>{t('hooksDescriptionSave')}</Button>
                  {' '}<Button variant="outline" onClick={() => { setEditing(undefined) }}>{t('hooksDescriptionCancel')}</Button>
                </form>
                : <div>
                  {description === undefined ? null : <span>{description} </span>}
                  <Button variant="outline" onClick={() => { setEditing({ id, draft: description ?? '' }) }}>
                    {t(description === undefined ? 'hooksDescriptionAdd' : 'hooksDescriptionEdit')}
                  </Button>
                </div>}
            </li>
          })}</ul>
        </article>
      })}
    </>}
  </section>
}
