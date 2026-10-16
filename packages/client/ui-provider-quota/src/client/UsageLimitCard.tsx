/** The usage warning share on the Plugins page, mounted while the Host serves the quota-controller namespace. */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels, NS } from './locales.ts'
import { NEAR_LIMIT_MAX, NEAR_LIMIT_MIN, type UsageLimitCardFace } from './usage-limit-card-controller.ts'

/** Props the renderer binds for the usage warning page. */
export type UsageLimitCardProps = PropsRuntime<'plugins.item'> & PropsLocale<typeof NS> & InjectFace<UsageLimitCardFace>

/**
 * Render the usage warning share as the Plugins page asks: its one-liner, or its form.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function UsageLimitCard(props: UsageLimitCardProps) {
  const { t } = props
  const state = props.useUsageLimitCard(snapshot => snapshot)
  if (props.view === 'summary') return t('usageSettingsDescription')
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <SettingsValueField
        id="plugin-config-provider-quota-near-limit"
        label={t('nearLimitLabel')}
        hint={t('nearLimitHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('resetDefault')}
        invalidLabel={t('nearLimitInvalid', { min: String(NEAR_LIMIT_MIN), max: String(NEAR_LIMIT_MAX) })}
        numeric
        disabled={!state.writable}
        {...state.nearLimitPercent}
        onEdit={(text) => { props.edit('nearLimitPercent', text) }}
        onReset={() => { props.resetField('nearLimitPercent') }}
      />
    </SettingsForm>
  )
}
