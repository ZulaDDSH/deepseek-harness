/** Read-only loaded hook configuration and bridge enablement. */
import { useEffect, useState } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './PluginInventorySettingsTab.module.css'

/** Props supplied by the Settings section registration. */
export type HooksSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<Pick<PluginInventorySettingsTabInjected, 'list'>>

/** Show current bridge reports without changing hook configuration.
 * @param props Localized Settings props and the inventory reader.
 * @returns Hook source, loaded commands and load diagnostics.
 */
export function HooksSettingsSection({ t, list }: HooksSettingsSectionProps) {
  const [snapshot, setSnapshot] = useState<PluginInventorySnapshot>()
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let current = true
    setSnapshot(undefined)
    setFailed(false)
    void list().then((value) => { if (current) setSnapshot(value) }, () => { if (current) setFailed(true) })
    return () => { current = false }
  }, [list, revision])
  return <section className={css.section}>
    <h2>{t('hooksTitle')}</h2>
    <p>{t('hooksHelp')}</p>
    <Button variant="outline" onClick={() => setRevision(value => value + 1)}>{t('hooksRefresh')}</Button>
    {failed ? <p role="alert">{t('error')}</p> : snapshot === undefined ? <p>{t('loading')}</p> : <>
      {(snapshot.hooks?.length ?? 0) === 0 ? <p>{t('hooksEmpty')}</p> : null}
      {snapshot.hooks?.map((report, index) => <article key={index}>
        <h3>{report.dialect}</h3>
        <p><code>{report.source}</code> — {t(report.status === 'loaded' ? 'hooksLoaded' : 'hooksFailed')}</p>
        {report.error === undefined ? null : <p role="alert">{report.error}</p>}
        <ul>{report.handlers.map((handler, position) => <li key={position}>
          <strong>{handler.event}</strong> {handler.matcher === undefined ? t('hooksAll') : <code>{handler.matcher}</code>}
          <pre className={css.hookCommand}>{handler.command}</pre>
        </li>)}</ul>
        {report.skipped.length === 0 ? null : <><h4>{t('hooksSkipped')}</h4>
          <ul>{report.skipped.map((reason, position) => <li key={position}>{reason}</li>)}</ul></>}
      </article>)}
      <h3>{t('hooksBridges')}</h3>
      <ul>{snapshot.entries.filter(entry => /dsh-hooks-(codex|claude-code)$/.test(entry.moduleName)).map(entry =>
        <li key={entry.entryId}>{entry.moduleName} — {t(entry.enabled ? 'enabledTag' : 'disabledTag')}
          {entry.fiberPhase === null ? null : ` (${t(entry.fiberPhase === 'loading' ? 'loadingPhase' : entry.fiberPhase)})`}</li>)}</ul>
    </>}
  </section>
}
