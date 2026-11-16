import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { MasterControlPage, type MasterControlPageProps } from './MasterControlPage.tsx'
import css from './MasterControlPage.module.css'

/** Renders the session dashboard beside an entry that opens the master chat in the conversation panel. */
export function MasterControlCenter(props: MasterControlPageProps) {
  const { openMasterChat, t } = props
  const [error, setError] = useState<string>()
  const [opening, setOpening] = useState(false)
  const open = () => {
    setError(undefined)
    setOpening(true)
    openMasterChat().catch((failure: unknown) => { setError(String(failure)) }).finally(() => { setOpening(false) })
  }
  return (
    <div className={css.controlCenter}>
      <section className={css.masterPane} aria-label={t('masterConversation')}>
        <h2 className={css.masterHeading}>{t('masterConversation')}</h2>
        <div className={css.masterBody}>
          <p>{t('masterHint')}</p>
          <Button disabled={opening} onClick={open}>{t('openMaster')}</Button>
          {error !== undefined && <div role="alert">{error}</div>}
        </div>
      </section>
      <section className={css.rosterPane} aria-label={t('sessionOverview')}>
        <MasterControlPage {...props} />
      </section>
    </div>
  )
}
