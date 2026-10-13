/**
 * Settings shell root: the sidebar-foot trigger row plus the centered modal
 * panel (figma 2552:26025, 760x500) with the section nav rail. The shell is
 * a pure composition face — slot-owned text (trigger label, panel title,
 * close label, sections) arrives from registrants through slots; accessible
 * names resolve from localized content (trigger: shell locale; dialog:
 * aria-labelledby the title node; close: visually-hidden slot text). Modal
 * open state and the active section id belong to the declared owner store.
 */
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  ConnectionIndicator, Tooltip, useModalLayer,
  IconAgentPresetOutlineMedium, IconArchiveOutlineMedium, IconCloseOutlineRegular, IconDataOutlineMedium,
  IconPersonalizationOutlineMedium, IconSettingsOutlineMedium, IconUserOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionIndicatorState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import css from './SettingsRoot.module.css'
import { DesktopUpdateIndicator } from './DesktopUpdateIndicator.tsx'
import { groupSections } from './section-groups.ts'
import { SearchBox, SearchResults, type SearchResult } from './SettingsSearch.tsx'

const RECOVERY_CONFIRMATION_MS = 2_000

/** Minimum visible time for the connecting pill; shorter attempts read as flicker. */
const CONNECTING_MIN_VISIBLE_MS = 800

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  if (id === 'account') return <IconUserOutlineMedium className={css.navIcon} size={16} />
  if (id === 'models') return <IconDataOutlineMedium className={css.navIcon} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutlineMedium className={css.navIcon} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutlineMedium className={css.navIcon} size={16} />
  if (id === 'archived-sessions') return <IconArchiveOutlineMedium className={css.navIcon} size={16} />
  return <IconSettingsOutlineMedium className={css.navIcon} size={16} />
}

type PanelProps = {
  rows: readonly SettingsSectionRow[]
  renderSlot: SettingsRootComponentProps['renderSlot']
  activeId: string | undefined
  t: SettingsRootComponentProps['t']
  search: SettingsRootComponentProps['search']
  useSearchTick: SettingsRootComponentProps['useSearchTick']
  useSaveStatus: SettingsRootComponentProps['useSaveStatus']
  onSelect: (id: string) => void
  onClose: () => void
}

const FOCUSABLE = 'input, button, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'

/** Whether a keystroke is going into a text field, where "/" must stay a character. */
function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
}

/** Pages whose label contains every word of the query, as results that open the page. */
function pageResults(rows: readonly SettingsSectionRow[], query: string, crumb: string): SearchResult[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/)
  return rows
    .filter(row => words.every(word => row.label.toLocaleLowerCase().includes(word)))
    .map(row => ({
      key: `page:${row.id}`, label: row.label, description: '', crumb,
      target: { kind: 'section', sectionId: row.id, anchor: undefined },
    }))
}

/**
 * Body-portaled modal layer: full-viewport mask + centered panel. Close paths: the
 * header button, a mask click, and document-level Escape (mounted only while
 * open, so the listener lifetime is the panel's).
 */
function SettingsPanel({ rows, renderSlot, activeId, t, search, useSearchTick, useSaveStatus, onSelect, onClose }: PanelProps) {
  // Entries can unmount underneath the requested id, so the render-time
  // projection falls back to the first row when the id is gone.
  const groups = groupSections(rows)
  const active = rows.find(r => r.id === activeId)?.id ?? groups[0]?.rows[0]?.id
  const titleId = useId()
  const [query, setQuery] = useState('')
  const [jump, setJump] = useState<{ section: string; anchor: string }>()
  const searchTick = useSearchTick(tick => tick)
  const saveState = useSaveStatus(status => status.state)

  const panel = useRef<HTMLDivElement>(null)
  const options = useRef<HTMLDivElement>(null)
  const nav = useRef<HTMLElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const resultList = useRef<HTMLUListElement>(null)
  useModalLayer(panel, true, onClose)

  const searching = query.trim() !== ''
  const results = useMemo<readonly SearchResult[]>(() => {
    if (!searching) return []
    const labels = new Map(rows.map(row => [row.id, row.label]))
    const settings = search(query).flatMap((item): SearchResult[] => {
      if (item.link !== undefined) {
        return [{ key: `entry:${item.id}`, label: item.label, description: item.description, crumb: item.link.place, target: { kind: 'link', open: item.link.open } }]
      }
      const sectionLabel = item.section === undefined ? undefined : labels.get(item.section)
      return item.section === undefined || sectionLabel === undefined ? [] : [{
        key: `entry:${item.id}`, label: item.label, description: item.description, crumb: sectionLabel,
        target: { kind: 'section', sectionId: item.section, anchor: item.anchor },
      }]
    })
    return [...pageResults(rows, query, t('search.page')), ...settings]
    // searchTick moves when the directory or the locale does; the search function itself is stable.
  }, [searching, query, rows, search, searchTick, t])

  const select = (id: string): void => {
    setQuery('')
    setJump(undefined)
    onSelect(id)
  }
  const open = (result: SearchResult): void => {
    setQuery('')
    const { target } = result
    if (target.kind === 'link') {
      onClose()
      target.open()
      return
    }
    setJump(target.anchor === undefined ? undefined : { section: target.sectionId, anchor: target.anchor })
    onSelect(target.sectionId)
  }

  // Runs once the target page has rendered: scroll to, flash and focus the chosen setting.
  useLayoutEffect(() => {
    if (jump === undefined || searching || active !== jump.section) return
    setJump(undefined)
    const target = [...options.current?.querySelectorAll<HTMLElement>('[data-settings-entry]') ?? []]
      .find(element => element.dataset['settingsEntry'] === jump.anchor)
    if (target === undefined) return
    if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' })
    target.setAttribute('data-settings-flash', '')
    target.addEventListener('animationend', () => { target.removeAttribute('data-settings-flash') }, { once: true })
    target.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true })
  }, [jump, searching, active])

  // The strip scrolls sideways in narrow windows; keep the open page visible in it.
  useLayoutEffect(() => {
    const current = nav.current?.querySelector<HTMLElement>('[aria-current="true"]')
    if (current != null && typeof current.scrollIntoView === 'function') current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const moveNav = (event: KeyboardEvent<HTMLElement>): void => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    let next: number
    switch (event.key) {
      case 'ArrowDown': case 'ArrowRight': next = Math.min(at + 1, buttons.length - 1); break
      case 'ArrowUp': case 'ArrowLeft': next = Math.max(at - 1, 0); break
      case 'Home': next = 0; break
      case 'End': next = buttons.length - 1; break
      default: return
    }
    event.preventDefault()
    buttons[next]?.focus()
  }
  const statusText = saveState === 'saving' ? t('save.saving')
    : saveState === 'saved' ? t('save.saved')
      : saveState === 'failed' ? t('save.failed') : ''

  // Portalled beside #root like the Modal primitive: a covering surface mounted
  // inside the root would precede the columns' chrome in document order, so a
  // chrome row that declares window drag after it would override its subtraction.
  // Beside the root, base.css's `body > :not(#root)` rule subtracts it instead.
  return createPortal((
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div ref={panel} tabIndex={-1} data-shortcut-modal="settings" className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || isTextEntry(event.target)) return
          event.preventDefault()
          searchInput.current?.focus()
        }}>
        <div className={css.rail}>
          <div className={css.navTitle} id={titleId} tabIndex={-1}
            data-modal-autofocus={active === undefined ? '' : undefined}>{renderSlot('settings.header', {})}</div>
          <SearchBox
            t={t}
            value={query}
            inputRef={searchInput}
            onChange={setQuery}
            onArrowDown={() => { resultList.current?.querySelector('button')?.focus() }}
            onEnter={() => { const [first] = results; if (first !== undefined) open(first) }}
          />
          <nav ref={nav} className={css.nav} aria-label={t('nav.label')} onKeyDown={moveNav}>
            {groups.map(group => (
              <div key={group.id} className={css.navGroup} role={group.labelKey === undefined ? undefined : 'group'}
                aria-label={group.labelKey === undefined ? undefined : t(group.labelKey)}>
                {group.labelKey === undefined ? null
                  : <div className={css.navGroupTitle} aria-hidden="true">{t(group.labelKey)}</div>}
                {group.rows.map(row => (
                  <button
                    key={row.id}
                    type="button"
                    className={clsx(css.navCell, row.id === active && css.active)}
                    aria-current={row.id === active ? 'true' : undefined}
                    data-modal-autofocus={row.id === active ? '' : undefined}
                    onClick={() => { select(row.id) }}
                  >
                    {navIcon(row.id)}
                    <span className={css.navLabel}>{row.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>
        <div className={css.content}>
          <div className={css.header}>
            <div className={css.actions}>
              <span className={css.saveStatus} role="status" data-state={saveState}>{statusText}</span>
              {renderSlot('settings.action', {})}
            </div>
            <button type="button" className={css.close} onClick={onClose}>
              <IconCloseOutlineRegular size={14} />
              <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
            </button>
          </div>
          <div className={css.options} ref={options} key={active} hidden={searching}>
            {active !== undefined && renderSlot('settings.section', { close: onClose }, { only: active })}
          </div>
          {searching ? (
            <div className={css.options}>
              <SearchResults t={t} query={query} results={results} listRef={resultList} onOpen={open}
                onArrowUpFromFirst={() => { searchInput.current?.focus() }} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  ), document.body)
}

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const {
    wide, reconnect, useConnectionState, useSections, renderSlot, t,
    useDesktopUpdate, openDesktopUpdate, useStore, actions, useShortcuts, search, useSearchTick, useSaveStatus,
  } = props
  const { open, activeId } = useStore(state => state)
  const shortcut = useShortcuts(rows => rows.find(row => row.id === 'settings.open'))
  const { close, openSection } = actions
  const [showRecovery, setShowRecovery] = useState(false)
  const [holdConnecting, setHoldConnecting] = useState(false)
  const connectingShownAt = useRef<number | undefined>(undefined)

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  const rows = useSections(s => s)
  const desktopUpdate = useDesktopUpdate(state => state)
  const connectionState = useConnectionState(state => state)
  const previousConnectionState = useRef(connectionState)
  useLayoutEffect(() => {
    const previous = previousConnectionState.current
    previousConnectionState.current = connectionState
    if (connectionState !== 'connected') {
      setShowRecovery(false)
      return
    }
    if (previous !== 'disconnected' && previous !== 'connecting') return
    setShowRecovery(true)
  }, [connectionState])

  // The confirmation window starts when the recovered pill becomes visible,
  // which the connecting minimum-visible hold can delay past the transition.
  useLayoutEffect(() => {
    if (!showRecovery || holdConnecting) return
    const timeout = window.setTimeout(() => { setShowRecovery(false) }, RECOVERY_CONFIRMATION_MS)
    return () => { window.clearTimeout(timeout) }
  }, [showRecovery, holdConnecting])

  useLayoutEffect(() => {
    if (connectionState === 'connecting') {
      connectingShownAt.current = Date.now()
      return
    }
    const shownAt = connectingShownAt.current
    if (shownAt === undefined) return
    connectingShownAt.current = undefined
    const remaining = CONNECTING_MIN_VISIBLE_MS - (Date.now() - shownAt)
    if (remaining <= 0) return
    setHoldConnecting(true)
    const timeout = window.setTimeout(() => { setHoldConnecting(false) }, remaining)
    return () => {
      window.clearTimeout(timeout)
      setHoldConnecting(false)
    }
  }, [connectionState])

  let connectionIndicator: ConnectionIndicatorState | undefined
  if (connectionState === 'connecting' || holdConnecting) {
    connectionIndicator = 'connecting'
  } else if (connectionState === 'disconnected') {
    connectionIndicator = 'disconnected'
  } else if (showRecovery) {
    connectionIndicator = 'recovered'
  }

  return (
    <>
      <div className={clsx(css.triggerRow, !wide && css.railRow)}>
        {renderSlot('settings.launcher', {
          wide, settingsOpen: open, openSettings: actions.open, openSection,
          ...(shortcut?.keys.length ? { settingsShortcut: { keys: shortcut.keys, aria: shortcut.aria } } : {}),
        }, { fallback: <Tooltip disabled={open} label={t('trigger')} shortcutKeys={shortcut?.keys}>
          <button
            type="button"
            className={clsx(css.trigger, !wide && css.rail)}
            aria-label={t('trigger')}
            aria-keyshortcuts={shortcut?.aria}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => { actions.open() }}
          >
            {renderSlot('settings.trigger', { wide })}
          </button>
        </Tooltip> })}
        <ConnectionIndicator
          state={wide && desktopUpdate.presentation?.phase !== 'installing' ? connectionIndicator : undefined}
          disconnectedLabel={t('connection.error')}
          connectingLabel={t('connection.connecting')}
          recoveredLabel={t('connection.connected')}
          reconnectActionLabel={t('connection.reconnect')}
          restartActionLabel={t('connection.restart')}
          onReconnect={reconnect}
        />
        <DesktopUpdateIndicator wide={wide} hidden={connectionIndicator !== undefined && desktopUpdate.presentation?.phase !== 'installing'}
          t={t} view={desktopUpdate} onOpen={openDesktopUpdate} />
      </div>
      {open && (
        <SettingsPanel
          rows={rows}
          renderSlot={renderSlot}
          activeId={activeId}
          t={t}
          search={search}
          useSearchTick={useSearchTick}
          useSaveStatus={useSaveStatus}
          onSelect={actions.select}
          onClose={close}
        />
      )}
    </>
  )
}
