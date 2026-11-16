/** General Settings control for full-text search over past session contents. */
import { useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DeveloperToolsRow.module.css'

/** Accepted setting and ordered mutation supplied by the settings owner. */
export interface SessionSearchRowInjected {
  hooks: { contentSearch: ObservableSnapshot<boolean> }
  setEnabled(enabled: boolean): Promise<void>
}

/**
 * Render the session content search toggle.
 * @param props - accepted preference, writer and localized copy.
 * @returns the General Settings row.
 */
export function SessionSearchRow({ useContentSearch, setEnabled, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<SessionSearchRowInjected>) {
  const enabled = useContentSearch(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('sessionSearch.title')}</div>
      <div className={css.description}>{t('sessionSearch.description')}</div>
      {failed && <div className={css.error} role="alert">{t('sessionSearch.error')}</div>}
    </div>
    <Switch checked={enabled} disabled={busy} label={t('sessionSearch.title')}
      onChange={(next) => {
        setFailed(false)
        setBusy(true)
        void setEnabled(next).catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
      }} />
  </div>
}
