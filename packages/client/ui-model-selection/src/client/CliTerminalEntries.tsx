import { useEffect, useState } from 'react'
import type { CliTerminalProfileId } from '@deepseek-ai/dsh-session/types'
import type { CliTerminalStatus } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelKey } from './locales.ts'
import css from './ModelSelect.module.css'

const COPY = {
  'gemini-cli': { label: 'cli.gemini-cli.label', note: 'cli.gemini-cli.note' },
  'grok-cli': { label: 'cli.grok-cli.label', note: 'cli.grok-cli.note' },
  'cursor-cli': { label: 'cli.cursor-cli.label', note: 'cli.cursor-cli.note' },
} satisfies Record<CliTerminalProfileId, { label: ModelKey; note: ModelKey }>

/**
 * List the CLI terminal profiles, installed ones as entries and absent ones as install links.
 * @param props - translated copy, the installed-state probe and the pick handler.
 * @returns the labelled group, or nothing until the probe answers.
 */
export function CliTerminalEntries({ t, probe, onPick }: PropsLocale<'model'> & {
  probe: (signal: AbortSignal) => Promise<readonly CliTerminalStatus[]>
  onPick: (profile: CliTerminalProfileId) => void
}) {
  const [statuses, setStatuses] = useState<readonly CliTerminalStatus[]>([])
  useEffect(() => {
    const controller = new AbortController()
    probe(controller.signal).then(setStatuses, () => { setStatuses([]) })
    return () => { controller.abort() }
  }, [probe])
  if (statuses.length === 0) return null
  return (
    <section className={css.section} role="group" aria-label={t('cli.group')}>
      <div className={css.sectionLabel}>{t('cli.group')}</div>
      {statuses.map(status => status.installed ? (
        <button key={status.profile} type="button" role="menuitem" className={css.option} onClick={() => { onPick(status.profile) }}>
          <span className={css.optionCopy}>
            <span className={css.modelName}>{t(COPY[status.profile].label)}</span>
            <span className={css.modelMeta}>{t(COPY[status.profile].note)}</span>
          </span>
        </button>
      ) : (
        <a key={status.profile} className={css.option} href={status.installUrl} target="_blank" rel="noopener noreferrer">
          <span className={css.optionCopy}>
            <span className={css.modelName}>{t(COPY[status.profile].label)}</span>
            <span className={css.modelMeta}>{t('cli.notInstalled')}</span>
          </span>
        </a>
      ))}
    </section>
  )
}
