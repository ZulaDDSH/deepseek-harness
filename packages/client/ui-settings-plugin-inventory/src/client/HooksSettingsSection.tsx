import { useEffect, useState } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './PluginInventorySettingsTab.module.css'

type HookInventoryReport = NonNullable<PluginInventorySnapshot['hooks']>[number]

export interface HooksSettingsSectionInjected extends Pick<PluginInventorySettingsTabInjected, 'list'> {
  setEnabledHooks: (entryId: string, keys: readonly string[]) => Promise<void>
}

export type HooksSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<HooksSettingsSectionInjected>

export function hookName(command: string): string {
  const words = command.split(/\s+/).map(word => word.replaceAll('"', '').replaceAll("'", ''))
  const script = words.find(word => /\.(m?js|cjs|ts|sh|ps1|py|cmd|bat|exe)$/i.test(word)) ?? words[0] ?? command
  return (script.split(/[\/]/).pop() ?? script).replace(/\.[^.]+$/, '')
}

export function HooksSettingsSection({ t, list, setEnabledHooks }: HooksSettingsSectionProps) {
  const [snapshot, setSnapshot] = useState<PluginInventorySnapshot>()
  const [failed, setFailed] = useState(false)
  const [writeFailed, setWriteFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let current = true
    setFailed(false)
    void list().then((value) => { if (current) setSnapshot(value) }, () => { if (current) setFailed(true) })
    return () => { current = false }
  }, [list, revision])
  const bridgeOf = (report: HookInventoryReport): string | undefined =>
    snapshot?.entries.find(entry => entry.enabled && entry.moduleName.endsWith(`dsh-hooks-${report.dialect}`))?.entryId
  const write = (entryId: string, enabled: readonly string[]): void => {
    setBusy(true)
    setWriteFailed(false)
    void setEnabledHooks(entryId, enabled)
      .catch(() => { setWriteFailed(true) })
      .finally(() => {
        setBusy(false)
        setRevision(value => value + 1)
      })
  }
  const enabledOf = (report: HookInventoryReport): string[] =>
    report.handlers.filter(handler => handler.disabled !== true).map(handler => handler.key)
  const controlled = (snapshot?.hooks ?? []).filter(report => report.status !== 'configured')
  return <section className={css.section}>
    <h2>{t('hooksTitle')}</h2>
    <p>{t('hooksHelp')}</p>
    <Button variant="outline" onClick={() => setRevision(value => value + 1)}>{t('hooksRefresh')}</Button>
    {writeFailed ? <p role="alert">{t('hooksWriteFailed')}</p> : null}
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
          <ul>{report.handlers.map((handler, position) => <li key={position} title={handler.command}>
            {entryId === undefined ? null : <Switch
              checked={handler.disabled !== true}
              disabled={busy}
              label={`${t('hooksToggle')}: ${hookName(handler.command)} ${handler.event}`}
              onChange={(on) => {
                const others = enabledOf(report).filter(key => key !== handler.key)
                write(entryId, on ? [...others, handler.key] : others)
              }}
            />}
            {' '}<strong>{hookName(handler.command)}</strong> — {handler.event}
          </li>)}</ul>
        </article>
      })}
    </>}
  </section>
}
