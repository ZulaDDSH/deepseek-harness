/** The Claude Code settings page: the Profile default for native ultracode. */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import type { ClaudeCodeCardFace } from './claude-code-card-controller.ts'
import css from './ClaudeCodeCard.module.css'

/** Props the renderer binds for the Claude Code page. */
export type ClaudeCodeCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.subagent'>
  & InjectFace<ClaudeCodeCardFace>

/**
 * Render the Claude Code one-liner or its settings form, as the Plugins page asks.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function ClaudeCodeCard(props: ClaudeCodeCardProps) {
  const { t } = props
  const state = props.useClaudeCodeCard(snapshot => snapshot)
  if (props.view === 'summary') return t('claudeCodeDescription')
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <div className={css.field}>
        <div className={css.toggleRow}>
          <span className={css.toggleLabel}>{t('ultracodeLabel')}</span>
          <Switch
            checked={state.ultracode.text === 'true'}
            label={t('ultracodeLabel')}
            disabled={!state.writable || state.saving}
            onChange={(next) => { props.edit('ultracode', String(next)) }}
          />
        </div>
        <p className={css.hint}>{t('ultracodeHint')}</p>
        {state.ultracode.overridden
          ? (
            <button
              type="button"
              className={css.reset}
              disabled={!state.writable || state.saving}
              onClick={() => { props.resetField('ultracode') }}
            >
              {t('reset')}
            </button>
          )
          : <p className={css.hint}>{t('ultracodeUnset')}</p>}
      </div>
    </SettingsForm>
  )
}
