/**
 * @module dsh-client-ui-settings-models/client/BillingChoice
 */

import type { ReactNode } from 'react'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The two sources a provider's requests can bill to. */
export type BillingSource = 'api' | 'subscription'

/** The source the saved configuration uses now, or none while no sign-in exists. */
export type ActiveBilling = BillingSource | 'signed-out'

/** Copy key naming the active source. */
const ACTIVE_COPY = {
  api: 'billingActiveApi',
  subscription: 'billingActiveSubscription',
  'signed-out': 'billingActiveSignedOut',
} as const satisfies Record<ActiveBilling, keyof typeof en>

/** Props of {@link BillingChoice}. */
export interface BillingChoiceProps {
  /** The source the draft chooses. */
  value: BillingSource
  /** Whether an API key is stored or typed, which API credits require. */
  apiAvailable: boolean
  /** Whether the subscription can be chosen; false while the sign-in stores an API key. */
  subscriptionAvailable: boolean
  /** The source the saved configuration uses. */
  active: ActiveBilling
  /** Whether the choice is locked: read-only settings, a busy card, or a deployment pin. */
  disabled: boolean
  /** Receives the chosen source. */
  onChange: (next: BillingSource) => void
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Render the billing choice and the active source beneath it.
 * @param props - the chosen source, its availability, and the active source.
 * @returns the billing choice group.
 */
export function BillingChoice(props: BillingChoiceProps): ReactNode {
  const { value, apiAvailable, subscriptionAvailable, active, disabled, onChange, t } = props
  const option = (source: BillingSource, label: string, enabled: boolean, title?: string): ReactNode => (
    <button
      type="button"
      className={value === source ? styles['primaryButton'] : styles['secondaryButton']}
      aria-pressed={value === source}
      disabled={disabled || !enabled}
      {...title === undefined ? {} : { title }}
      onClick={() => { onChange(source) }}
    >
      {label}
    </button>
  )
  return (
    <div className={styles['field']}>
      <span className={styles['fieldLabel']}>{t('billingLabel')}</span>
      <div className={styles['signInOptions']} role="group" aria-label={t('billingLabel')}>
        {option('api', t('billingApi'), apiAvailable, apiAvailable ? undefined : t('billingApiUnavailable'))}
        {option('subscription', t('billingSubscription'), subscriptionAvailable)}
      </div>
      <p className={styles['advancedHint']}>{t('billingHint')}</p>
      {subscriptionAvailable ? null : <p className={styles['advancedHint']}>{t('billingSubscriptionUnavailable')}</p>}
      <p className={styles['advancedHint']}>{t(ACTIVE_COPY[active])}</p>
    </div>
  )
}
