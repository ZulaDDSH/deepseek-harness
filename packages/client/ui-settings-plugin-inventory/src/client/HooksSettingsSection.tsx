import { useEffect, useState } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
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
  const script = words.find(word => /\.(m?js|cjs|ts|sh|ps1|py|cmd|bat|exe)$/i.test(word)) ?? words[0] ?? command
  return (script.split(/[\/]/).pop() ?? script).replace(/\.[^.]+$/, '')
}

function groupByScript(handlers: HookInventoryReport['handlers']): [string, HookInventoryReport['handlers']][] {
  const groups = new Map<string, HookInventoryReport['handlers'][number][]>()
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
  useEffect(() => {
    let current = true
    setFailed(false)
    void list().then((value) => { if (current) setSnapshot(value) }, () => { if (current) setFailed(true) })
    return () => { current = false }
  }, [list, revision])
  const bridgeOf = (report: HookInventoryReport): string | undefined => report.status === 'loaded' ? report.settingsNs : undefined
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
  const controlled = (snapshot?.hooks ?? []).filter(report => report.status !== 'configured')
  return <section className={css.section}>
    <h2>{t('hooksTitle')}</h2>
    <p>{t('hooksHelp')}</p>
    <Button variant="outline" onClick={() => setRevision(value => value + 1)}>{t('hooksRefresh')}</Button>
    {writeFailed === undefined ? null : <p role="alert">{t('hooksWriteFailed')}: {writeFailed}</p>}
    {failed ? <p role="alert">{t('error')}</p> : snapshot === undefined ? <p>{t('loading')}</p> : <>
      {controlled.length === 0 ? <p>{t('hooksEmpty')}</p> : null}
      {controlled.map((report, index) => {
        const entryId = bridgeOf(report)
        return <article key={index}>
          <h3 title={report.source}>{report.dialect}</h3>
          {report.error === undefined ? null : <p role="alert">{report.error}</p>}
          {entryId !== undefined && report.handlers.length > 0 ? <p>
            <Button variant="outline" disabled={busy} onClick={() => { write(entryId, report.handlers.map(handler => handler.key)) }}>
              {t('hooksEnableAll')}
            </Button>
            {' '}
            <Button variant="outline" disabled={busy} onClick={() => { write(entryId, []) }}>{t('hooksDisableAll')}</Button>
          </p> : null}
          <ul>{groupByScript(report.handlers).map(([name, handlers]) => {
            const keys = handlers.map(handler => handler.key)
            const on = handlers.every(handler => handler.disabled !== true)
            const description = handlers.find(handler => handler.description !== undefined)?.description
            const id = `${report.dialect}/${name}`
            return <li key={name} title={[...new Set(handlers.map(handler => handler.command))].join('\n')}>
              {entryId === undefined ? null : <Switch
                checked={on}
                disabled={busy}
                label={`${t('hooksToggle')}: ${name}`}
                onChange={(next) => {
                  const others = enabledOf(report).filter(key => !keys.includes(key))
                  write(entryId, next ? [...others, ...keys] : others)
                }}
              />}
              {' '}<strong>{name}</strong> — <small>{[...new Set(handlers.map(handler => handler.event))].join(', ')}</small>
              {editing?.id === id && entryId !== undefined
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
                  {entryId === undefined ? null : <Button variant="outline" onClick={() => { setEditing({ id, draft: description ?? '' }) }}>
                    {t(description === undefined ? 'hooksDescriptionAdd' : 'hooksDescriptionEdit')}
                  </Button>}
                </div>}
            </li>
          })}</ul>
        </article>
      })}
    </>}
  </section>
}
