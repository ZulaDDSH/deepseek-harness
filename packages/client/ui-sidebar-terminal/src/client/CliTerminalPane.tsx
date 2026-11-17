import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { CliTerminalProfileId } from '@deepseek-ai/dsh-session/types'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CliTerminalInjected } from './face.ts'
import type { zh } from './locales.ts'
import { TerminalScreen } from './terminal.tsx'
import css from './terminal.module.css'

const PROFILE_NAME = {
  'gemini-cli': 'cli.profile.gemini-cli',
  'grok-cli': 'cli.profile.grok-cli',
  'cursor-cli': 'cli.profile.cursor-cli',
} satisfies Record<CliTerminalProfileId, keyof typeof zh>

/** Owner profile plus the injected terminal model, close action, theme and localized copy. */
export type CliTerminalPaneProps = { readonly profile: CliTerminalProfileId }
  & InjectFace<CliTerminalInjected> & PropsLocale<'sidebarTerminal'>

/**
 * Render the Session's CLI terminal with its profile name and Close action.
 * @param props - profile, terminal model lookup, close action, application theme and translated copy.
 * @returns the header bar, terminal screen, install hint, exit status, loading or error line.
 */
export function CliTerminalPane({ profile, cli, close, useTheme, t }: CliTerminalPaneProps): ReactNode {
  const model = cli(profile)
  const state = useSyncExternalStore(listener => model.state.subscribe(listener), () => model.state.getSnapshot())
  const theme = useTheme(value => value)
  useEffect(() => model.mount(), [model])
  const info = state.info
  const error = state.issue === undefined ? state.error ?? info?.error : t(state.issue)
  return (
    <section className={css.root} data-cli-terminal={profile}>
      <header className={css.cliBar}>
        <span className={css.cliName}>{t(PROFILE_NAME[profile])}</span>
        <Button variant="outline" size="sm" onClick={() => { close(profile) }}>{t('cli.close')}</Button>
      </header>
      {info?.cli !== undefined && !info.cli.installed && (
        <p className={css.status} role="note">
          {t('cli.install', { command: info.cli.command })} <a href={info.cli.installUrl} target="_blank" rel="noopener noreferrer">{t('cli.installLink')}</a>
        </p>
      )}
      {info?.state === 'exited' && <p className={css.status} role="status">{t('exited', { code: String(info.exitCode ?? '—') })}</p>}
      {info === undefined && error === undefined && <p className={css.status} role="status">{t('loading')}</p>}
      {info !== undefined && <TerminalScreen state={state} model={model} visible label={t('cli.label')} theme={theme} />}
      {error !== undefined && <p className={css.error} role="alert">{t('failed', { message: error })}</p>}
    </section>
  )
}
