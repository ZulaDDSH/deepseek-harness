import { useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DeveloperToolsRow.module.css'

export interface ProductAnalyticsRowInjected {
  hooks: { productAnalytics: ObservableSnapshot<boolean> }
  setEnabled(enabled: boolean): Promise<void>
}

export function ProductAnalyticsRow({ useProductAnalytics, setEnabled, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<ProductAnalyticsRowInjected>) {
  const enabled = useProductAnalytics(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('productAnalytics.title')}</div>
      <div className={css.description}>{t('productAnalytics.description')}</div>
      {failed && <div className={css.error} role="alert">{t('productAnalytics.error')}</div>}
    </div>
    <Switch checked={enabled} disabled={busy} label={t('productAnalytics.title')}
      onChange={(next) => {
        setFailed(false)
        setBusy(true)
        void setEnabled(next).catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
      }} />
  </div>
}
