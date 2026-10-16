import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { IconDataOutlineRegular, IconRefreshOutlineMedium, Tooltip, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { QuotaBillingSwitch, QuotaProviderView, QuotaResult, QuotaWindow, QuotaWindowId } from '@deepseek-ai/dsh-api-quota-controller/types'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { NS, type ProviderQuotaKey } from './locales.ts'
import css from './ProviderQuotaAction.module.css'

/** Writes one provider's billing choice and reports the refusal, if any. */
export type SwitchBilling = (billing: QuotaBillingSwitch, target: 'api' | 'subscription', providerId: string, resetAt?: number) => Promise<string | undefined>

export interface ProviderQuotaActionInjected {
  hooks: {
    providers: ObservableSnapshot<readonly QuotaProviderView[] | null>
    state: ObservableSnapshot<{ readonly status: 'idle' | 'loading' | 'ready' | 'error'; readonly results: readonly QuotaResult[]; readonly message?: string }>
  }
  refresh: () => Promise<void>
  switchBilling: SwitchBilling
}

export type ProviderQuotaActionProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<typeof NS> & InjectFace<ProviderQuotaActionInjected>

type Translate = (key: ProviderQuotaKey, params?: Record<string, string>) => string

const WINDOWS: readonly QuotaWindowId[] = ['5h', 'weekly', 'weekly-opus', 'weekly-sonnet', 'monthly', 'overage', 'credits']

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

/** An instant in the browser's locale and time zone. */
export function instantLabel(at: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at)
}

/** Reset instant in the browser's locale and time zone; absent when the provider reported none. */
export function resetLabel(resetAt: number | null): string | undefined {
  if (resetAt === null || !Number.isFinite(resetAt)) return undefined
  return instantLabel(resetAt)
}

function sessionTokenLabel(usage: TokenUsageProjection): string {
  const total = usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  return new Intl.NumberFormat().format(total)
}

/** One usage window: its label, the metric in its severity color, and when it resets. */
function WindowRow({ id, window, t }: {
  window: QuotaWindow
  id: QuotaWindowId
  t: Translate
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

/** The billing choice of one provider, with the switch that flips it. */
function BillingLine({ result, switchBilling, t }: {
  result: QuotaResult
  switchBilling: SwitchBilling
  t: Translate
}): ReactNode {
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const billing = result.billing
  if (billing === undefined) return null
  const option = billing.switch
  const target = billing.active === 'api' ? 'subscription' : 'api'
  return (
    <div className={css.billing}>
      <span className={css.reset}>{t('billingUsing', { source: t(billing.active === 'api' ? 'billingApi' : 'billingSubscription', { provider: result.providerName }) })}</span>
      {option === undefined ? null
        : billing.active === 'subscription' && !option.apiKeyStored ? <span className={css.reset}>{t('addKeyToSwitch', { provider: result.providerName })}</span>
          : <button type="button" className={css.switch} onClick={() => {
            void switchBilling(option, target, result.providerId).then(setRefusal)
          }}
          >{t(target === 'api' ? 'switchToApi' : 'switchToSubscription', { provider: result.providerName })}</button>}
      {refusal !== undefined && <span className={`${css.providerMessage} ${css.error}`}>{refusal}</span>}
    </div>
  )
}

/** One billing source's heading, marked when requests bill to it. */
function SourceHeading({ label, active, t }: { label: string; active: boolean; t: Translate }): ReactNode {
  return (
    <div className={css.windowLine}>
      <span className={css.windowLabel}>{label}</span>
      {active && <span className={css.reset}>{t('inUseForRequests')}</span>}
    </div>
  )
}

/** The API spending limit a request hit, with the date access returns when the provider named one. */
function ApiLimitLine({ result, t }: { result: QuotaResult; t: Translate }): ReactNode {
  const limit = result.apiLimit
  if (limit === undefined) return null
  const until = resetLabel(limit.resetAt)
  return (
    <>
      <span className={`${css.providerMessage} ${css.error}`}>{until === undefined ? t('apiLimitNoDate') : t('apiLimitUntil', { time: until })}</span>
      {result.billing?.active === 'subscription' && <span className={css.reset}>{t('apiLimitMismatch', { provider: result.providerName })}</span>}
    </>
  )
}

/** One provider: its windows, or the failure the fetch reported. */
function ProviderSection({ result, t, switchBilling }: {
  result: QuotaResult
  t: Translate
  switchBilling: SwitchBilling
}): ReactNode {
  const rows = result.ok ? WINDOWS.flatMap((id) => {
    const window = result.windows?.[id]
    return window === undefined ? [] : [<WindowRow key={id} id={id} window={window} t={t} />]
  }) : []
  const message = result.ok && result.awaitingUsage === true
    ? t('awaitingUsage', { provider: result.providerName })
    : result.subscriptionError !== undefined ? t('subscriptionUnavailable', { message: result.subscriptionError }) : result.error ?? t('unavailable')
  const billing = result.billing
  const showSubscription = billing?.switch !== undefined
  return (
    <section className={css.provider}>
      <header className={css.providerName}>{result.providerName}</header>
      {showSubscription && <SourceHeading label={t('billingSubscription', { provider: result.providerName })} active={billing.active === 'subscription'} t={t} />}
      {rows.length > 0 ? rows : <p className={css.providerMessage}>{message}</p>}
      {rows.length > 0 && result.subscriptionError !== undefined && <span className={css.reset}>{t('subscriptionUnavailable', { message: result.subscriptionError })}</span>}
      {result.asOf !== undefined && <span className={css.reset}>{t('asOf', { time: instantLabel(result.asOf) })}</span>}
      {billing !== undefined && (billing.active === 'api' || result.apiLimit !== undefined) && (
        <>
          <SourceHeading label={t('billingApi', { provider: result.providerName })} active={billing.active === 'api'} t={t} />
          <ApiLimitLine result={result} t={t} />
        </>
      )}
      <BillingLine result={result} switchBilling={switchBilling} t={t} />
      {result.billing?.active === 'api' && result.billing.consoleUrl !== undefined && (
        <a className={css.link} href={result.billing.consoleUrl} target="_blank" rel="noreferrer">{t('consoleLink', { provider: result.providerName })}</a>
      )}
    </section>
  )
}

/**
 * Session-header quota trigger and its per-provider window popover.
 * @param props - the injected providers/state hooks, refresh command, billing switch, and locale seat.
 * @returns the database-icon trigger and, while open, the usage popover.
 */
export function ProviderQuotaAction(props: ProviderQuotaActionProps): React.JSX.Element {
  const providers = props.useProviders(value => value)
  const state = props.useState(value => value)
  const sessionUsage = props.useProjection('tokenUsage')
  const sessionTokens = sessionUsage === undefined ? undefined : sessionTokenLabel(sessionUsage)
  const modelUsage = props.useProjection('modelUsage')
  const selection = props.useProjection('modelSelection')?.next
  const selectedResult = state.results.find(result => result.providerId === selection?.provider)
  const ordered = selectedResult === undefined
    ? state.results
    : [selectedResult, ...state.results.filter(result => result !== selectedResult)]
  const signedIn = ordered.filter(result => result.configured)
  const notSetUp = ordered.filter(result => !result.configured)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useDismissOnOutsidePointer(rootRef, open, setOpen)
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])
  const toggle = (): void => {
    const next = !open
    setOpen(next)
    if (next && state.status !== 'loading') void props.refresh()
  }
  return (
    <span ref={rootRef} className={css.root}>
      <Tooltip label={props.t('title')}>
        <button ref={triggerRef} type="button" className={css.trigger} aria-label={props.t('title')} aria-expanded={open} onClick={toggle}>
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
        {modelUsage !== undefined && modelUsage.length > 0 && <section className={css.provider}>
          <header className={css.providerName}>{props.t('modelUsage')}</header>
          {modelUsage.map(entry => <p key={JSON.stringify([entry.provider, entry.model])}>{props.t('modelTokens', { provider: entry.provider, model: entry.model, tokens: sessionTokenLabel(entry.usage) })}</p>)}
        </section>}
        <section className={css.provider}>
          <header className={css.providerName}>{props.t('accountQuota')}</header><p>{props.t('sharedQuota')}</p>
        </section>
        {providers === null || state.status === 'loading' ? <p>{props.t('loading')}</p>
          : state.status === 'error' ? <p>{props.t('error', { message: state.message ?? props.t('unavailable') })}</p>
            : providers.length === 0 ? <p>{props.t('empty')}</p>
              : state.results.length === 0 ? <p>{props.t('unavailable')}</p>
                : <>
                  {signedIn.map(result => (
                    <ProviderSection key={result.providerId} result={result} t={props.t} switchBilling={props.switchBilling} />
                  ))}
                  {notSetUp.length > 0 && <p className={css.notSetUp}>
                    {props.t('notSetUp', { providers: notSetUp.map(result => result.providerName).join(', ') })}
                    <span className={css.reset}> {props.t('setUpHint')}</span>
                  </p>}
                </>}
      </div>}
    </span>
  )
}
