/** Browser toolbar and Web iframe renderer. */
import { createElement, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconLinkOutline14,
  IconRefreshOutline14,
  IconRightUpOutline16,
  SHIELD_OUTLINE_PATH,
  SHIELD_OUTLINE_STROKE,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserInjected } from '../browser/BrowserController.ts'
import type { BrowserFrameState } from '../browser/BrowserFrame.ts'
import { BrowserNavigation } from '../browser/BrowserNavigation.ts'
import type { BrowserAddressFailure } from '../browser/url.ts'
import type { BrowserStore } from '../browser/store.ts'
import css from './Browser.module.css'

/** Fixed Web iframe sandbox; popups escape the sandbox while top navigation remains absent. */
export const WEB_BROWSER_SANDBOX = 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox'

const INITIAL_BROWSER_FRAME: BrowserFrameState = { document: undefined, sandboxed: true, loadFailed: false }

type DesktopWebviewElement = HTMLElement & {
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
  /** Live address of the guest; absent on a carrier that cannot report one. */
  getURL?(): string
}

function isDesktopWebview(): boolean {
  return typeof navigator !== 'undefined' && /Electron\//u.test(navigator.userAgent)
}

/**
 * Read the guest's current address, tolerating a guest that is not attached or
 * already torn down: `getURL()` throws before `dom-ready` and after detach, and
 * that throw would escape a React effect cleanup.
 * @param webview - the mounted guest element, when one exists.
 * @returns the live address, or undefined when the guest cannot report one.
 */
function liveAddressOf(webview: DesktopWebviewElement | null): string | undefined {
  try {
    return webview?.getURL?.()
  } catch {
    // A guest that never reached dom-ready or is already detached has no address.
    return undefined
  }
}

function SandboxPolicyIcon({ sandboxed }: { readonly sandboxed: boolean }): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={SHIELD_OUTLINE_PATH} stroke="currentColor" strokeWidth={SHIELD_OUTLINE_STROKE} strokeLinejoin="round" />
      {sandboxed
        ? <path d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z" fill="currentColor" />
        : <path d="M10.6074 4.40278L8.00975 6.99973L10.6074 9.59739L9.59736 10.6074L6.9997 8.00978L4.40274 10.6074L3.3927 9.59739L5.98966 6.99973L3.3927 4.40278L4.40274 3.39273L6.9997 5.98969L9.59736 3.39273L10.6074 4.40278Z" fill="currentColor" transform="translate(1.2 0.8)" />}
    </svg>
  )
}

/** Browser body props assembled by the tab seat. */
export type BrowserBodyProps = PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<BrowserStore>
  & PropsLocale<'sidebarBrowser'>
  & InjectFace<BrowserInjected>

/** Translate one parser refusal without matching display strings in logic. */
function failureText(reason: BrowserAddressFailure, t: BrowserBodyProps['t']): string {
  return t(`error.${reason}`)
}

function useBrowserDraft(
  controlledUrl: string | undefined,
  requestId: number | undefined,
): readonly [string, (value: string) => void] {
  const [edit, setEdit] = useState<{ readonly requestId: number | undefined; readonly value: string }>()
  const value = edit !== undefined && edit.requestId === requestId ? edit.value : controlledUrl ?? ''
  return [value, (draft) => { setEdit({ requestId, value: draft }) }]
}

/** Browser tab renderer for a controller-owned URL state and Web iframe carrier. */
export function BrowserBody(props: BrowserBodyProps): ReactNode {
  const {
    goBack, goForward, loadUrl, mount, reload, reportLoaded, reportLoadFailed, reportNavigated, toggleSandbox,
    useBrowserFrame, useStore, useTabInfo, t,
  } = props
  const { tab } = useTabInfo()
  const state = useStore(snapshot => snapshot.byTab[tab.id]) ?? BrowserNavigation.empty()
  const initialState = useRef(state)
  const initialUrl = useRef(tab.navigation.params?.url)
  const current = BrowserNavigation.current(state)
  const [draft, setDraft] = useBrowserDraft(BrowserNavigation.effectiveUrl(state) ?? initialUrl.current, state.request?.revision)
  const [mountCount, setMountCount] = useState(0)
  const [carrierReady, setCarrierReady] = useState(false)
  const [desktopWebview, setDesktopWebview] = useState<DesktopWebviewElement | null>(null)

  useEffect(() => {
    mount(tab.id, tab.signal, window.location.origin, initialState.current)
    setMountCount(count => count + 1)
  }, [mount, tab.id, tab.signal])

  useEffect(() => {
    if (mountCount === 0) return
    const resumed = BrowserNavigation.current(initialState.current)
    // The carrier is a fresh element after every body unmount, so it loads once
    // and only after the address is settled: rendering it first would open the
    // entry's original address and then reload onto the observed one.
    if (resumed !== undefined) reload(tab.id)
    else if (initialUrl.current !== undefined) loadUrl(tab.id, initialUrl.current)
    setCarrierReady(true)
  }, [loadUrl, mountCount, reload, tab.id])

  const frameState = useBrowserFrame(tab.id) ?? INITIAL_BROWSER_FRAME
  const { document, sandboxed, loadFailed } = frameState

  useEffect(() => {
    if (!desktopWebview || document === undefined) return
    const revision = document.revision
    const onStopLoading: EventListener = () => { reportLoaded(tab.id, revision) }
    const onFailedLoad: EventListener = (event) => {
      const detail = event as Event & { errorCode?: number; isMainFrame?: boolean }
      if (detail.isMainFrame === false || detail.errorCode === -3) return
      reportLoadFailed(tab.id, revision)
    }
    // A site-managed or in-page navigation (a single-page app route change)
    // changes the guest address without the harness directing it; recording it
    // is what lets a remount return to the live page instead of the one the
    // tab opened.
    const onNavigated: EventListener = (event) => {
      const url = (event as Event & { url?: unknown }).url
      if (typeof url === 'string' && url.length > 0) reportNavigated(tab.id, url)
    }
    desktopWebview.addEventListener('did-stop-loading', onStopLoading)
    desktopWebview.addEventListener('did-fail-load', onFailedLoad)
    desktopWebview.addEventListener('did-navigate', onNavigated)
    desktopWebview.addEventListener('did-navigate-in-page', onNavigated)
    return () => {
      desktopWebview.removeEventListener('did-stop-loading', onStopLoading)
      desktopWebview.removeEventListener('did-fail-load', onFailedLoad)
      desktopWebview.removeEventListener('did-navigate', onNavigated)
      desktopWebview.removeEventListener('did-navigate-in-page', onNavigated)
      // The guest is destroyed with this body; capture where it actually was so
      // the persisted observation outlives the unmount.
      const live = liveAddressOf(desktopWebview)
      if (live !== undefined && live.length > 0) reportNavigated(tab.id, live)
    }
  }, [desktopWebview, document, reportLoadFailed, reportLoaded, reportNavigated, tab.id])

  const navigationUnknown = state.navigation.status === 'unknown'
  const externalUrl = navigationUnknown ? undefined : BrowserNavigation.effectiveUrl(state)
  const submit = (event: FormEvent): void => { event.preventDefault(); loadUrl(tab.id, draft) }
  const failure = state.failure === undefined ? undefined : failureText(state.failure.reason, t)
  const placeholder = current === undefined ? t('start') : t('loading')

  return (
    <div className={css.root}>
      <form className={css.toolbar} onSubmit={submit}>
        <button type="button" className={css.tool} aria-label={t('back')} title={t('back')} disabled={!BrowserNavigation.canGoBack(state)} onClick={() => { goBack(tab.id) }}><IconChevronLeftOutline14 /></button>
        <button type="button" className={css.tool} aria-label={t('forward')} title={t('forward')} disabled={!BrowserNavigation.canGoForward(state)} onClick={() => { goForward(tab.id) }}><IconChevronRightOutline14 /></button>
        <button type="button" className={css.tool} aria-label={t('reload')} title={t('reload')} disabled={current === undefined} onClick={() => { reload(tab.id) }}><IconRefreshOutline14 /></button>
        <div className={css.addressBox}>
          <input
            className={`${css.address} ${navigationUnknown ? css.addressUnknown : ''}`}
            value={draft}
            aria-label={t('address.placeholder')}
            placeholder={t('address.placeholder')}
            spellCheck={false}
            onChange={(event) => { setDraft(event.currentTarget.value) }}
          />
          {navigationUnknown && <span className={css.addressChanged}>{t('address.changed')}</span>}
          <button type="submit" className={`${css.tool} ${css.addressGo}`} aria-label={t('go')} title={t('go')}><IconLinkOutline14 /></button>
        </div>
        <button
          type="button"
          className={css.tool}
          aria-label={t('external')}
          title={t('external')}
          disabled={externalUrl === undefined}
          onClick={() => {
            /* v8 ignore next -- React does not dispatch clicks from this disabled button. */
            if (externalUrl !== undefined) window.open(externalUrl, '_blank', 'noopener,noreferrer')
          }}
        ><IconRightUpOutline16 size={14} /></button>
        <button
          type="button"
          className={`${css.tool} ${sandboxed ? '' : css.sandboxOff}`}
          aria-label={t(sandboxed ? 'sandbox.disable' : 'sandbox.enable')}
          title={t(sandboxed ? 'sandbox.disable' : 'sandbox.enable')}
          aria-pressed={!sandboxed}
          disabled={mountCount === 0}
          onClick={() => { toggleSandbox(tab.id) }}
        ><SandboxPolicyIcon sandboxed={sandboxed} /></button>
      </form>
      {!sandboxed && <div className={css.sandboxWarning} role="status">{t('sandbox.warning')}</div>}
      {loadFailed && <div className={css.failure} role="status">{t('web.loadFailed')}</div>}
      {failure !== undefined && <div className={css.failure} role="alert">{failure}</div>}
      {document === undefined || !carrierReady
        ? <div className={css.start}>{placeholder}</div>
        : isDesktopWebview()
          ? createElement('webview', {
            key: `${document.target.url}:${String(document.revision)}`,
            className: css.frame,
            src: document.src,
            partition: 'persist:dsh-browser',
            allowpopups: true,
            ref: (element: DesktopWebviewElement | null): void => { setDesktopWebview(element) },
            title: document.target.title,
            'data-sidebar-browser-frame': true,
          })
          : <iframe
            key={`${document.target.url}:${String(document.revision)}`}
            className={css.frame}
            src={document.src}
            sandbox={sandboxed ? WEB_BROWSER_SANDBOX : undefined}
            referrerPolicy="no-referrer"
            title={document.target.title}
            onLoad={() => { reportLoaded(tab.id, document.revision) }}
            /* v8 ignore next -- jsdom does not dispatch React iframe error events; BrowserFrame owns the tested behavior. */
            onError={() => { reportLoadFailed(tab.id, document.revision) }}
            data-sidebar-browser-frame
          />}
      {navigationUnknown && <p className={css.limit}>{t('web.unknown')}</p>}
    </div>
  )
}
