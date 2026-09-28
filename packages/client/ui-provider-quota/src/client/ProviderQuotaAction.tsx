import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconDataOutlineRegular, IconRefreshOutlineMedium, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { QuotaResult, QuotaWindow, QuotaWindowId } from '@deepseek-ai/dsh-api-quota-controller/types'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { NS, type ProviderQuotaKey } from './locales.ts'
import css from './ProviderQuotaAction.module.css'

export interface ProviderQuotaActionInjected {
  hooks: {
    providers: ObservableSnapshot<readonly { readonly id: string; readonly name: string }[] | null>
    state: ObservableSnapshot<{ readonly status: 'idle' | 'loading' | 'ready' | 'error'; readonly results: readonly QuotaResult[]; readonly message?: string }>
  }
  refresh: () => Promise<void>
}

export type ProviderQuotaActionProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<typeof NS> & InjectFace<ProviderQuotaActionInjected>

const WINDOWS: readonly QuotaWindowId[] = ['5h', 'weekly', 'monthly', 'credits']

/** Rounded used percentage, or null when the provider reported none. */
function usedPercent(window: QuotaWindow): number | null {
  return window.usedPercent === null ? null : Math.round(window.usedPercent)
}

/** Severity of one window at its used fraction: error at 80, warning at 50. */
function windowTone(used: number | null): 'ok' | 'warn' | 'error' {
  if (used === null) return 'ok'
  if (used >= 80) return 'error'
  if (used >= 50) return 'warn'
  return 'ok'
}

/** Reset instant in the browser's locale and time zone; absent when the provider reported none. */
function resetLabel(resetAt: number | null): string | undefined {
  if (resetAt === null || !Number.isFinite(resetAt)) return undefined
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(resetAt)
}

function sessionTokenLabel(usage: TokenUsageProjection | undefined): string | undefined {
  if (usage === undefined) return undefined
  const total = usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  return new Intl.NumberFormat().format(total)
}

/** One usage window: its label, the metric in its severity color, and when it resets. */
function WindowRow({ id, window, t }: {
  window: QuotaWindow
  id: QuotaWindowId
  t: (key: ProviderQuotaKey, params?: Record<string, string>) => string
}): ReactNode {
  const percent = usedPercent(window)
  const tone = windowTone(percent)
  const reset = resetLabel(window.resetAt)
  const metric = window.valueLabel ?? (percent === null ? null : t('used', { percent: String(percent) }))
  // A provider token other than `ok` is the window's headline: it says the
  // window cannot serve, which the percentage alone would not.
  const alert = window.status !== undefined && window.status.toLowerCase() !== 'ok'
  return (
    <div className={css.window}>
      <div className={css.windowLine}>
        <span className={css.windowLabel}>{t(`window.${id}`)}</span>
        {alert
          ? <span className={`${css.windowValue} ${css.error}`}>{window.status}</span>
          : metric !== null && <span className={`${css.windowValue} ${css[tone]}`}>{metric}</span>}
      </div>
      {reset !== undefined && <span className={css.reset}>{t('reset', { time: reset })}</span>}
    </div>
  )
}

/** One provider: its windows, or the failure the fetch reported. */
function ProviderSection({ result, t }: {
  result: QuotaResult
  t: (key: ProviderQuotaKey, params?: Record<string, string>) => string
}): ReactNode {
  const rows = result.ok ? WINDOWS.flatMap((id) => {
    const window = result.windows?.[id]
    return window === undefined ? [] : [<WindowRow key={id} id={id} window={window} t={t} />]
  }) : []
  return (
    <section className={css.provider}>
      <header className={css.providerName}>{result.providerName}</header>
      {rows.length > 0 ? rows : <p className={css.providerMessage}>{result.error ?? t('unavailable')}</p>}
    </section>
  )
}

/**
 * Session-header quota trigger and its per-provider window popover.
 * @param props - the injected providers/state hooks, refresh command, and locale seat.
 * @returns the database-icon trigger and, while open, the usage popover.
 */
export function ProviderQuotaAction(props: ProviderQuotaActionProps): React.JSX.Element {
  const providers = props.useProviders(value => value)
  const state = props.useState(value => value)
  const sessionTokens = sessionTokenLabel(props.useProjection('tokenUsage'))
  const [open, setOpen] = useState(false)
  const toggle = (): void => {
    const next = !open
    setOpen(next)
    if (next && state.status !== 'loading') void props.refresh()
  }
  return (
    <span className={css.root}>
      <Tooltip label={props.t('title')}>
        <button type="button" className={css.trigger} aria-label={props.t('title')} aria-expanded={open} onClick={toggle}>
          <IconDataOutlineRegular size={16} />
          {state.status === 'loading' && <span className={css.dot} aria-hidden />}
        </button>
      </Tooltip>
      {open && <div className={css.popover} role="dialog" aria-label={props.t('title')}>
        <header className={css.header}>
          <strong>{props.t('title')}</strong>
          <button type="button" className={css.refresh} aria-label={props.t('refresh')} onClick={() => { void props.refresh() }}><IconRefreshOutlineMedium size={14} /></button>
        </header>
        {sessionTokens !== undefined && <p className={css.sessionTotal}>{props.t('sessionTotal', { tokens: sessionTokens })}</p>}
        {providers === null || state.status === 'loading' ? <p>{props.t('loading')}</p>
          : state.status === 'error' ? <p>{props.t('error', { message: state.message ?? props.t('unavailable') })}</p>
            : providers.length === 0 ? <p>{props.t('empty')}</p>
              : state.results.length === 0 ? <p>{props.t('unavailable')}</p>
                : state.results.map(result => <ProviderSection key={result.providerId} result={result} t={props.t} />)}
      </div>}
    </span>
  )
}
