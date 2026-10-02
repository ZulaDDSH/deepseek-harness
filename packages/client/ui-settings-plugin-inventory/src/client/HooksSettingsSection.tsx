import { useEffect, useState } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './PluginInventorySettingsTab.module.css'

type HookInventoryReport = NonNullable<PluginInventorySnapshot['hooks']>[number]

export interface HooksSettingsSectionInjected extends Pick<PluginInventorySettingsTabInjected, 'list'> {
  setDisabledHooks: (entryId: string, keys: readonly string[]) => Promise<void>
}

export type HooksSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<HooksSettingsSectionInjected>

export function HooksSettingsSection({ t, list, setDisabledHooks }: HooksSettingsSectionProps) {
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
  const bridgeOf = (report: HookInventoryReport): string | undefined => report.status !== 'loaded' ? undefined
    : snapshot?.entries.find(entry => entry.enabled && entry.moduleName.endsWith(`dsh-hooks-${report.dialect}`))?.entryId
  const write = (entryId: string, disabled: readonly string[]): void => {
    setBusy(true)
    setWriteFailed(false)
    void setDisabledHooks(entryId, disabled)
      .catch(() => { setWriteFailed(true) })
      .finally(() => {
        setBusy(false)
        setRevision(value => value + 1)
      })
  }
  const disabledOf = (report: HookInventoryReport): string[] =>
    report.handlers.filter(handler => handler.disabled === true).map(handler => handler.key)
  return <section className={css.section}>
    <h2>{t('hooksTitle')}</h2>
    <p>{t('hooksHelp')}</p>
    <Button variant="outline" onClick={() => setRevision(value => value + 1)}>{t('hooksRefresh')}</Button>
    {writeFailed ? <p role="alert">{t('hooksWriteFailed')}</p> : null}
    {failed ? <p role="alert">{t('error')}</p> : snapshot === undefined ? <p>{t('loading')}</p> : <>
      {(snapshot.hooks?.length ?? 0) === 0 ? <p>{t('hooksEmpty')}</p> : null}
      {snapshot.hooks?.map((report, index) => {
        const entryId = bridgeOf(report)
        return <article key={index}>
          <h3>{report.dialect}</h3>
          <p><code>{report.source}</code> — {t(report.status === 'loaded' ? 'hooksLoaded' : report.status === 'configured' ? 'hooksConfigured' : 'hooksFailed')}</p>
          {report.error === undefined ? null : <p role="alert">{report.error}</p>}
          {entryId !== undefined && report.handlers.length > 0 ? <p>
            <Button variant="outline" disabled={busy} onClick={() => { write(entryId, []) }}>{t('hooksEnableAll')}</Button>
            {' '}
            <Button variant="outline" disabled={busy} onClick={() => { write(entryId, report.handlers.map(handler => handler.key)) }}>
              {t('hooksDisableAll')}
            </Button>
          </p> : null}
          <ul>{report.handlers.map((handler, position) => <li key={position}>
            {entryId !== undefined ? <Switch
              checked={handler.disabled !== true}
              disabled={busy}
              label={`${t('hooksToggle')}: ${handler.event} ${handler.command}`}
              onChange={(enabled) => {
                const others = disabledOf(report).filter(key => key !== handler.key)
                write(entryId, enabled ? others : [...others, handler.key])
              }}
            /> : null}
            {' '}<strong>{handler.event}</strong> {handler.matcher === undefined ? t('hooksAll') : <code>{handler.matcher}</code>}
            <pre className={css.hookCommand}>{handler.command}</pre>
          </li>)}</ul>
          {report.skipped.length === 0 ? null : <><h4>{t('hooksSkipped')}</h4>
            <ul>{report.skipped.map((reason, position) => <li key={position}>{reason}</li>)}</ul></>}
        </article>
      })}
      <h3>{t('hooksBridges')}</h3>
      <ul>{snapshot.entries.filter(entry => /dsh-hooks-(codex|claude-code)$/.test(entry.moduleName)).map(entry =>
        <li key={entry.entryId}>{entry.moduleName} — {t(entry.enabled ? 'enabledTag' : 'disabledTag')}
          {entry.fiberPhase === null ? null : ` (${t(entry.fiberPhase === 'loading' ? 'loadingPhase' : entry.fiberPhase)})`}</li>)}</ul>
    </>}
  </section>
}
