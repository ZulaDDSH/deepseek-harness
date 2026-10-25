import { useEffect, useState } from 'react'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { MasterControlPage, type MasterControlPageProps } from './MasterControlPage.tsx'
import css from './MasterControlPage.module.css'

/** Props for the control-center page: dashboard props plus the conversation slot. */
export type MasterControlCenterProps = MasterControlPageProps & PropsRenderSlots<'main.conversation'>

/** Renders the master conversation beside the session dashboard, reusing one master chat. */
export function MasterControlCenter(props: MasterControlCenterProps) {
  const { acquireMasterChat, SessionProvider, renderSlot, t } = props
  const [reference, setReference] = useState<SessionReference>()
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let held: SessionReference | undefined
    setReference(undefined)
    setError(undefined)
    acquireMasterChat(controller.signal).then((result) => {
      if (controller.signal.aborted) { result.release(); return }
      held = result
      setReference(result)
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(String(failure))
    })
    return () => { controller.abort(); held?.release() }
  }, [acquireMasterChat, attempt])
  return (
    <div className={css.controlCenter}>
      <section className={css.masterPane} aria-label={t('masterConversation')}>
        <h2 className={css.masterHeading}>{t('masterConversation')}</h2>
        <div className={css.masterBody}>
          {reference !== undefined
            ? <SessionProvider session={reference}>{renderSlot('main.conversation', {})}</SessionProvider>
            : error !== undefined
              ? <div role="alert">{error}<Button onClick={() => { setAttempt(value => value + 1) }}>{t('retryMaster')}</Button></div>
              : <p role="status">{t('loadingMaster')}</p>}
        </div>
      </section>
      <section className={css.rosterPane} aria-label={t('sessionOverview')}>
        <MasterControlPage {...props} />
      </section>
    </div>
  )
}
