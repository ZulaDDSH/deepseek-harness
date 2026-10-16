/** General Settings control for saving finished chats to Memorix and recalling related ones. */
import { useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DeveloperToolsRow.module.css'

/** Accepted setting and ordered mutation supplied by the settings owner. */
export interface ChatMemoryRowInjected {
  hooks: { chatMemory: ObservableSnapshot<boolean> }
  setEnabled(enabled: boolean): Promise<void>
}

/**
 * Render the chat memory toggle.
 * @param props - accepted preference, writer and localized copy.
 * @returns the General Settings row.
 */
export function ChatMemoryRow({ useChatMemory, setEnabled, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<ChatMemoryRowInjected>) {
  const enabled = useChatMemory(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('chatMemory.title')}</div>
      <div className={css.description}>{t('chatMemory.description')}</div>
      {failed && <div className={css.error} role="alert">{t('chatMemory.error')}</div>}
    </div>
    <Switch checked={enabled} disabled={busy} label={t('chatMemory.title')}
      onChange={(next) => {
        setFailed(false)
        setBusy(true)
        void setEnabled(next).catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
      }} />
  </div>
}
