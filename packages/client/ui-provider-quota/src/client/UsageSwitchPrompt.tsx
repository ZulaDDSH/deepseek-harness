import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { QuotaWindowId } from '@deepseek-ai/dsh-api-quota-controller/types'
import { NS, type ProviderQuotaKey } from './locales.ts'
import { resetLabel, type SwitchBilling } from './ProviderQuotaAction.tsx'
import { OPEN_WINDOW_HOLD_MS, usagePrompt, type UsagePrompt, type UsageSwitch } from './usage-prompt.ts'
import type { QuotaState } from './controller.ts'
import css from './UsageSwitchPrompt.module.css'

export interface UsageSwitchPromptInjected {
  hooks: {
    state: ObservableSnapshot<QuotaState>
    dismissed: ObservableSnapshot<readonly string[]>
    switched: ObservableSnapshot<UsageSwitch | undefined>
    nearLimit: ObservableSnapshot<number>
  }
  dismiss: (key: string) => void
  switchBilling: SwitchBilling
  refreshValues: () => Promise<void>
}

export type UsageSwitchPromptProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<typeof NS> & InjectFace<UsageSwitchPromptInjected>

type Translate = (key: ProviderQuotaKey, params?: Record<string, string>) => string

function whenClause(resetAt: number | null, t: Translate): string {
  const reset = resetLabel(resetAt)
  return reset === undefined ? '' : t('resetWhen', { time: reset })
}

function limitMessage(prompt: Extract<UsagePrompt, { windowId: QuotaWindowId }>, t: Translate): string {
  const { result, window } = prompt
  const offersSwitch = result.billing?.switch !== undefined
  const params = {
    provider: result.providerName,
    window: t(`span.${prompt.windowId}`),
    percent: String(Math.round(window.usedPercent ?? 0)),
    when: whenClause(window.resetAt, t),
  }
  if (prompt.kind === 'hard-limit') return t(offersSwitch ? 'promptHardSwitch' : 'promptHard', params)
  return t(offersSwitch ? 'promptNearSwitch' : 'promptNear', params)
}

/** Composer-dock usage prompt: one near-limit, hard-limit, or switch-back offer at a time. */
export function UsageSwitchPrompt(props: UsageSwitchPromptProps): ReactNode {
  const { t, refreshValues } = props
  const state = props.useState(value => value)
  const dismissed = props.useDismissed(value => value)
  const switched = props.useSwitched(value => value)
  const nearLimitPercent = props.useNearLimit(value => value)
  const running = props.useSession(snapshot => snapshot.running)
  const wasRunning = useRef(running)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (wasRunning.current && !running) void refreshValues()
    wasRunning.current = running
  }, [running, refreshValues])
  const prompt = usagePrompt(state.results, {
    dismissed: new Set(dismissed),
    ...switched === undefined ? {} : { switched },
    nearLimitPercent,
    now: Date.now(),
  })
  if (prompt === undefined) return null
  const switchBack = prompt.kind === 'switch-back'
  const option = prompt.result.billing?.switch
  const provider = prompt.result.providerName
  const switchTo = (): void => {
    if (option === undefined) return
    const resetAt = prompt.kind === 'switch-back' ? undefined : prompt.window.resetAt ?? Date.now() + OPEN_WINDOW_HOLD_MS
    void props.switchBilling(option, switchBack ? 'subscription' : 'api', prompt.result.providerId, resetAt).then(setRefusal)
  }
  return (
    <div className={css.prompt} role="status">
      <span className={css.text}>{prompt.kind === 'switch-back' ? t('promptBack', { provider }) : limitMessage(prompt, t)}</span>
      {!switchBack && option === undefined && <span className={css.text}>{t('pickModel')}</span>}
      {!switchBack && option !== undefined && !option.apiKeyStored && <span className={css.text}>{t('addKeyToSwitch', { provider })}</span>}
      {refusal !== undefined && <span className={css.text}>{refusal}</span>}
      <span className={css.actions}>
        {option !== undefined && (switchBack || option.apiKeyStored) && <Button variant="outline" size="sm" onClick={switchTo}>
          {t(switchBack ? 'switchToSubscription' : 'switchToApi', { provider })}
        </Button>}
        <Button variant="ghost" size="sm" onClick={() => { props.dismiss(prompt.key) }}>{t('notNow')}</Button>
      </span>
    </div>
  )
}
