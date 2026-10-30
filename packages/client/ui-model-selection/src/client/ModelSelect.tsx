/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron),
 * each drilling into its own list — the provider-grouped model list over
 * the shared directory, and the effort levels. The trigger (313:14108's
 * ToggleButton) shows both: model name + effort in the caption tone.
 * Model catalogs above four entries show search, which retains focus while
 * ↑/↓ cycle the highlighted result; Enter and Tab accept it. Smaller model
 * catalogs, root panes, and effort panes move focus between rows. Escape and Shift+Tab leave a drilled pane first and otherwise close
 * back to the trigger. A drilled pane focuses the current effort or model
 * search field. Provider headings paint their background only while pinned
 * by scrolling. Clearing a query restores the full list and search focus.
 * Selecting restores trigger focus without a ring until the trigger loses focus
 * or the menu reopens. Mobile devices restore button focus when opening or
 * drilling; model search takes focus only after explicit user input.
 * Model names match a case-insensitive ordered subsequence
 * within each provider group, ranked by
 * prefix, alignment score, then catalog order. Returning to the root pane
 * hands focus back to the cell that opened it. Data and submission ride the
 * same per-session ModelDirectory as the /model popup; exact-model reasoning
 * metadata and the selected effort come from the Host rather than a
 * client-owned vocabulary. A rejected selection announces through the shared
 * transient Toast anchored to the composer card; the in-menu strip with
 * Retry remains the catalog-load surface. While the directory's pending
 * selection is unsettled, the trigger shows a spinner in place of its
 * chevron, and each row whose value that selection carries shows one in place
 * of its check mark.
 */
import { MenuGroup, MenuSurface, observeStickyMenuGroups } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type FocusEvent,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionRunOptions, SessionRunOptionsProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconCloseFillRegular,
  IconDataOutlineRegular, IconWarningOutlineRegular, Input, isMobileDevice, Pill, rankByName, StateDot, Switch, Tag, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'
import type { ModelKey } from './locales.ts'
import type { ModelLabelOwner, ModelSelectInjected } from './slots.ts'
import { CliTerminalEntries } from './CliTerminalEntries.tsx'
import { descriptionOf, rowId } from './descriptions.ts'
import css from './ModelSelect.module.css'
import { orderModelProviders } from './provider-order.ts'
import { subagentLockOf } from './subagent-lock.ts'

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  ultracode?: boolean
}

type CatalogModel = ModelDirectoryState['groups'][number]['models'][number]

const ROW_SELECTOR = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="radio"]:not(:disabled), [role="switch"]:not(:disabled)'

/** Keyboard-walkable controls of the open card, in DOM order. */
function rowsOf(menu: HTMLElement | null): HTMLElement[] {
  return [...menu?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? []]
}

/** The selection a model row submits: its provider, id, and default effort. */
function selectionFor(providerId: string, model: CatalogModel): ModelSelection {
  return {
    provider: providerId,
    model: model.id,
    ...model.reasoning?.defaultEffort === undefined
      ? {}
      : { reasoningEffort: model.reasoning.defaultEffort },
  }
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.4 9.95 5.35l4.36.63-3.16 3.08.75 4.35L8 11.36l-3.9 2.05.75-4.35-3.16-3.08 4.36-.63L8 1.4Z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

/** Unplaced portal card: hidden but laid out at a fixed origin so offsetWidth/offsetHeight are real (Menu primitive's measure pass). */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

const NO_RUN_OPTIONS: SessionRunOptions = {}
/** Claude Code native effort levels with their labels, faster to smarter. */
const CLAUDE_EFFORTS = [
  ['low', 'runOptions.effortLow'],
  ['medium', 'runOptions.effortMedium'],
  ['high', 'runOptions.effortHigh'],
  ['xhigh', 'runOptions.effortXhigh'],
  ['max', 'runOptions.effortMax'],
] as const satisfies readonly (readonly [NonNullable<SessionRunOptions['effort']>, ModelKey])[]

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export function ModelSelect(
  { locked, useProjection, available, useModelDirectory, load, select, useModelFavorites, toggleFavorite, setRunOptions, openCliTerminal,
    cliProfiles, openSubagentSetup, useGlobalSetup, resolveText, renderSlot, t }:
  Pick<PropsRuntime<'conversation.input.model'>, 'locked' | 'useProjection'> & InjectFace<ModelSelectInjected> & PropsLocale<'model'>
    & Omit<PropsRenderSlots<'conversation.input.model.label'>, 'SessionProvider'>,
) {
  const state = useModelDirectory(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const [query, setQuery] = useState('')
  const [providerFilter, setProviderFilter] = useState<string | null>(null)
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const [selectionFocus, setSelectionFocus] = useState(false)
  const favoriteIds = useModelFavorites(ids => ids)
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const projectedRunOptions = useProjection('runOptions')
  const claudeCodeRunOptions = useProjection('claudeCodeRunOptions', capability => capability !== undefined)
  const globalSetup = useGlobalSetup(value => value)
  const { on: subagentSetupOn, effortLocked, route: drivenRoute } = subagentLockOf(projectedRunOptions?.current?.subagentSetup, globalSetup)
  const runOptionsWritable = setRunOptions !== undefined && projectedRunOptions !== undefined
  const latestRunOptions = useRef(projectedRunOptions)
  useEffect(() => { latestRunOptions.current = projectedRunOptions }, [projectedRunOptions])
  const [runOptionsDraft, setRunOptionsDraft] = useState<{
    value: SessionRunOptions
    seen: SessionRunOptionsProjection | undefined | null
  } | null>(null)
  const runOptionsWrites = useRef({ queue: Promise.resolve(), inflight: 0, epoch: 0 })
  const runOptionsCurrent: SessionRunOptions = runOptionsDraft !== null
    && (runOptionsDraft.seen === null || runOptionsDraft.seen === projectedRunOptions)
    ? runOptionsDraft.value
    : projectedRunOptions?.current ?? NO_RUN_OPTIONS
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const groupsRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const accountProviderName = t('provider.account')
  const groups = useMemo(() => orderModelProviders(state.groups).map(group => ({
    ...group,
    provider: {
      id: group.id,
      name: group.id === 'deepseek-account' ? accountProviderName : group.name,
    },
  })), [state.groups, accountProviderName])
  const choices = useMemo(() => groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: selectionFor(group.id, model),
    }))), [groups])
  const showSearch = choices.length > 4
  const filteredSections = useMemo(() => {
    const matching = groups
      .filter(group => providerFilter === null || group.id === providerFilter)
      .map(group => ({ group, models: rankByName(group.models, showSearch ? query.trim() : '') }))
    const providerSections = matching.map(({ group, models }) => ({
      key: group.id,
      label: group.provider.name,
      rows: models
        .filter(model => providerFilter !== null || !favoriteSet.has(rowId(group.id, model.id)))
        .map(model => ({ group, model })),
    })).filter(section => section.rows.length > 0)
    if (providerFilter !== null) return providerSections
    const favorites = matching.flatMap(({ group, models }) => models
      .filter(model => favoriteSet.has(rowId(group.id, model.id)))
      .map(model => ({ group, model })))
    return favorites.length === 0
      ? providerSections
      : [{ key: 'favorites', label: t('favorites.title'), rows: favorites }, ...providerSections]
  }, [groups, providerFilter, showSearch, query, favoriteSet, t])
  const visibleRows = useMemo(() => filteredSections.flatMap(section => section.rows), [filteredSections])
  const currentVisibleIndex = visibleRows.findIndex(row =>
    row.group.id === state.current?.provider && row.model.id === state.current.model)
  const activeModelIndex = Math.min(highlightedIndex ?? Math.max(0, currentVisibleIndex), visibleRows.length - 1)
  const shown = drivenRoute ?? state.current
  const selectedIndex = shown === null
    ? -1
    : choices.findIndex(c => c.selection.provider === shown.provider && c.selection.model === shown.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = shown?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? drivenRoute === undefined ? state.retainedEffort : drivenRoute.reasoningEffort
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
      })),
      ...currentChoice?.model.ultracode === true && runOptionsWritable
        ? [{ key: 'ultracode', effort: (reasoning.efforts.find(level => level.id === 'xhigh') ?? reasoning.efforts.at(-1))?.id, label: t('runOptions.ultracode'), ultracode: true }]
        : [],
    ], [reasoning, currentChoice, runOptionsWritable, t])
  const ultracodeOn = currentChoice?.model.ultracode === true && runOptionsCurrent.ultracode === true
  const { pending } = state
  const busy = pending !== null

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      // The portaled card is outside the trigger subtree; check both.
      if (rootRef.current?.contains(event.target as Node) === true) return
      if (menuRef.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  useLayoutEffect(() => {
    if (!showSearch) {
      setQuery('')
      setHighlightedIndex(null)
    }
  }, [showSearch])

  // Pane switches unmount the focused row; restore focus inside the menu so
  // keyboard navigation remains available.
  const paneFocus = useRef<'drill' | 'model' | 'effort' | null>(null)
  const previousShowSearch = useRef(showSearch)
  useEffect(() => {
    const changedSearchMode = previousShowSearch.current !== showSearch
    previousShowSearch.current = showSearch
    const intent = paneFocus.current ?? (changedSearchMode && pane === 'model' ? 'drill' : null)
    paneFocus.current = null
    if (!open || intent === null) return
    if (intent === 'drill') {
      if (pane === 'model' && showSearch && !isMobileDevice()) {
        searchRef.current?.focus()
        return
      }
      // The checked row is the value in use; a pane without one opens on its
      // first row.
      const checked = menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not([disabled])')
      const target = checked ?? itemRefs.current.find(item => item !== null && !item.disabled)
      // Rows a selection in flight disabled cannot take the keyboard; the
      // trigger does, so the card's keys still reach the menu.
      ;(target ?? triggerRef.current)?.focus()
      return
    }
    const cell = itemRefs.current[intent === 'effort' ? 1 : 0]
    ;(cell !== null && cell !== undefined && !cell.disabled ? cell : triggerRef.current)?.focus()
  }, [open, pane, showSearch])

  useEffect(() => {
    const viewport = groupsRef.current
    if (viewport === null) return
    return observeStickyMenuGroups(viewport)
  }, [available, open, pane, filteredSections])

  useLayoutEffect(() => {
    if (open && pane === 'model' && activeModelIndex >= 0) {
      itemRefs.current[activeModelIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [open, pane, activeModelIndex, visibleRows])

  // The portal needs viewport coordinates from the trigger and the menu's
  // measured size before paint. Slot content can resize without parent renders.
  useLayoutEffect(() => {
    if (!available || !open) { setMenuPos(null); return }
    const place = (): void => {
      /* v8 ignore next 2 -- the trigger ref is attached whenever the menu is open. */
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const MARGIN = 12
      const lw = menuRef.current?.offsetWidth ?? 0
      const lh = menuRef.current?.offsetHeight ?? 0
      let x = rect.right - lw
      let y = rect.top - 8 - lh
      if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - lw - MARGIN)
      if (lh > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - lh - MARGIN)
      setMenuPos({ left: x, top: y })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    const menu = menuRef.current
    const observer = typeof ResizeObserver !== 'undefined' && menu !== null
      ? new ResizeObserver(place)
      : null
    if (menu !== null) observer?.observe(menu)
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [available, open, pane, state, query, providerFilter, favoriteIds])

  if (!available) return null

  const show = (): void => {
    setSelectionFocus(false)
    triggerRef.current?.focus()
    setQuery('')
    setProviderFilter(null)
    setHighlightedIndex(null)
    if (currentChoice === undefined) paneFocus.current = 'drill'
    setPane(currentChoice === undefined ? 'model' : 'root')
    setOpen(true)
    reload()
  }

  const changeQuery = (next: string): void => {
    setQuery(next)
    setHighlightedIndex(0)
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const closeAfterSelection = (): void => {
    setSelectionFocus(true)
    close(true)
  }

  const drill = (next: Pane): void => {
    setQuery('')
    setHighlightedIndex(null)
    paneFocus.current = 'drill'
    setPane(next)
  }

  /** Leave a drilled pane for the root one, handing the keyboard back to its cell. */
  const back = (from: Exclude<Pane, 'root'>): void => {
    paneFocus.current = from
    setPane('root')
  }

  const moveFocus = (offset: number): void => {
    const items = rowsOf(menuRef.current)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    // Focus outside the rows (the trigger, which keeps it while the menu
    // opens) enters at the end the step comes from: the first row forward,
    // the last row backward.
    const next = active === -1
      ? (offset > 0 ? 0 : items.length - 1)
      : (active + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root' && currentChoice !== undefined) back(pane)
      else close(true)
      return
    }
    if (!open) return
    if (pane === 'model' && showSearch && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      if (!busy && visibleRows.length > 0) {
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setHighlightedIndex((activeModelIndex + direction + visibleRows.length) % visibleRows.length)
        searchRef.current?.focus()
      }
      return
    }
    if (pane === 'model' && showSearch && event.target instanceof HTMLInputElement
      && (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) {
      if (event.key === 'Tab' && visibleRows.length === 0) return
      event.preventDefault()
      const highlighted = visibleRows[activeModelIndex]
      if (!busy && highlighted !== undefined) choose(selectionFor(highlighted.group.id, highlighted.model))
      return
    }
    // Tab settles like Enter and Shift+Tab leaves like Escape, so the menu's
    // keys mean what they mean in the composer. Both are consumed: the card
    // keeps the browser's focus traversal out while it is open.
    if (event.key === 'Tab') {
      if (event.shiftKey) {
        event.preventDefault()
        if (pane !== 'root' && currentChoice !== undefined) back(pane)
        else close(true)
        return
      }
      // Run-option controls (switches, Claude Code effort) apply on click; Tab leaves them instead of settling like a model row.
      const focused = document.activeElement
      if (focused instanceof HTMLElement && menuRef.current?.contains(focused) === true
        && (focused.getAttribute('role') === 'switch' || focused.hasAttribute('data-run-option'))) {
        event.preventDefault()
        close(true)
        return
      }
      // Settling activates the row the keyboard is on; with focus still on the
      // trigger, Tab enters the menu at the value in use instead. Any other
      // control inside the card (a retry button) keeps the browser's traversal,
      // so the keystroke stays unconsumed there.
      const rows = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null)
      if (focused instanceof HTMLButtonElement && rows.includes(focused)) {
        event.preventDefault()
        focused.click()
        return
      }
      if (focused !== triggerRef.current) return
      event.preventDefault()
      if (pane === 'model' && showSearch) {
        setHighlightedIndex(null)
        searchRef.current?.focus()
        return
      }
      const checked = menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not([disabled])')
      ;(checked ?? rows.find(item => !item.disabled))?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && (
      rootRef.current?.contains(event.relatedTarget) === true
      || menuRef.current?.contains(event.relatedTarget) === true
    )) return
    close()
  }

  const announce = (error: { readonly code: string; readonly message: string }): void => {
    toastSeq.current += 1
    setToast({
      seq: toastSeq.current,
      text: error.code === 'session/writer-held'
        ? t('error.sessionInUse')
        : t('error.action', { message: `${error.code}: ${error.message}` }),
    })
  }

  const settleSelection = (result: Awaited<ReturnType<ModelSelectInjected['select']>>): void => {
    if (result === undefined) return
    if (result.ok) {
      if (rootRef.current !== null) closeAfterSelection()
      return
    }
    announce(result.error)
  }

  const writeRunOptions = (patch: Partial<SessionRunOptions>): void => {
    if (setRunOptions === undefined) return
    const next: SessionRunOptions = { ...runOptionsCurrent, ...patch }
    const writes = runOptionsWrites.current
    const epoch = writes.epoch
    setRunOptionsDraft({ value: next, seen: null })
    writes.inflight += 1
    const settle = (): void => {
      writes.inflight -= 1
      if (writes.inflight === 0) setRunOptionsDraft(draft => draft === null ? null : { ...draft, seen: latestRunOptions.current })
    }
    const reject = (error?: { readonly code: string; readonly message: string }): void => {
      if (error !== undefined) announce(error)
      writes.epoch += 1
      setRunOptionsDraft(null)
    }
    const send = async (): Promise<void> => {
      // A rejected write voids the writes queued behind it: they were built on its optimistic value.
      if (epoch !== writes.epoch) { settle(); return }
      try {
        const result = await setRunOptions(next)
        if (result?.ok === true) return
        reject(result?.error)
      } catch (error) {
        reject({ code: 'run-options/write-failed', message: error instanceof Error ? error.message : String(error) })
      } finally {
        settle()
      }
    }
    writes.queue = writes.queue.then(send, send)
  }

  const submit = (selection: ModelSelection): void => {
    lastActionRef.current = 'select'
    // Disabled option rows cannot retain focus while a selection is pending.
    setSelectionFocus(true)
    triggerRef.current?.focus()
    void select(selection).then(settleSelection)
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      closeAfterSelection()
      return
    }
    submit(selection)
  }

  const chooseEffort = (level: EffortChoice): void => {
    if (state.current === null) return
    const ultracode = level.ultracode === true
    if (ultracode !== ultracodeOn) writeRunOptions({ ultracode })
    if (effortLocked || effectiveEffort === level.effort) {
      closeAfterSelection()
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...level.effort === undefined ? {} : { reasoningEffort: level.effort },
    }
    submit(selection)
  }

  let itemIndex = 0
  let modelIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  const renderModelLabel = (
    provider: ModelLabelOwner['provider'], model: ModelLabelOwner['model'],
    placement: ModelLabelOwner['placement'], selected: boolean,
  ) => (
    <span data-provider-id={provider.id} data-model-id={model.id}>
      {renderSlot('conversation.input.model.label', {
        provider, model, placement, selected,
      }, {
        fallback: model.badge === undefined ? model.name : (
          <span className={css.badgedName}>
            {placement === 'trigger' ? <><Tag className={css.badge} tone={model.badge.tone}>{resolveText(model.badge.text)}</Tag>{' '}</> : null}
            <span className={css.badgedNameText}>{model.name}</span>
            {placement === 'trigger' ? null : <>{' '}<Tag className={css.badge} tone={model.badge.tone}>{resolveText(model.badge.text)}</Tag></>}
          </span>
        ),
      })}
    </span>
  )
  const waiting = currentChoice === undefined && state.status === 'loading'
  const unroutedCurrent = shown !== null && state.routable === false && drivenRoute === undefined
  const providerListed = shown !== null && state.groups.some(group => group.id === shown.provider)
  const modelName = currentChoice?.model.name ?? (drivenRoute === undefined ? state.retainedName : undefined)
  const modelLabel = waiting
    ? t('trigger.loading')
    : shown === null
      ? t('trigger.fallback')
      : modelName ?? shown.model
  const modelTitle = waiting || shown === null
    ? modelLabel
    : modelName ?? `${shown.provider}/${shown.model}`
  const triggerLabel = effortLabel === undefined ? modelTitle : `${modelTitle} · ${effortLabel}`
  const baseAria = waiting
    ? t('trigger.loading')
    : shown === null
      ? t('trigger.selectAria')
      : effortLabel === undefined || ultracodeOn
        ? t('trigger.aria', { model: modelTitle })
        : t('trigger.ariaEffort', { model: modelTitle, effort: effortLabel })
  const availabilityAria = unroutedCurrent ? t('trigger.ariaUnavailable', { aria: baseAria }) : baseAria
  const fastOn = claudeCodeRunOptions && runOptionsCurrent.fastMode === true
  const runOptionNames = [
    ...fastOn ? [t('trigger.fast')] : [],
    ...ultracodeOn ? [t('trigger.ultracode')] : [],
  ]
  const triggerAria = runOptionNames.length === 0
    ? availabilityAria
    : t('trigger.ariaRunOptions', { aria: availabilityAria, options: runOptionNames.join(', ') })
  const effortsUnknown = currentChoice === undefined && shown !== null

  return (
    <div
      ref={rootRef}
      className={css.root}
      onKeyDown={onRootKeyDown}
      onBlur={onBlur}
      onMouseDown={(event) => {
        // WebKit blurs a focused row before click unless the button's mousedown keeps focus.
        if (event.target instanceof Element && event.target.closest('button') !== null) event.preventDefault()
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={unroutedCurrent ? `${triggerLabel} — ${t(providerListed ? 'trigger.unavailableModelHint' : 'trigger.unavailableHint')}` : triggerLabel}
        data-unavailable={unroutedCurrent ? '' : undefined}
        aria-busy={busy}
        data-selection-focus={selectionFocus ? '' : undefined}
        onBlur={() => { setSelectionFocus(false) }}
        disabled={locked}
        onClick={() => {
          if (open) {
            close(true)
          } else {
            show()
          }
        }}
      >
        <IconDataOutlineRegular className={css.triggerIcon} size={16} />
        {unroutedCurrent && <IconWarningOutlineRegular className={css.triggerWarning} size={14} aria-hidden />}
        <span className={css.triggerLabel}>
          {currentChoice === undefined ? modelLabel : renderModelLabel(currentChoice.group.provider, currentChoice.model, 'trigger', true)}
        </span>
        {effortLabel !== undefined && !ultracodeOn && <span className={css.triggerEffort}>{effortLabel}</span>}
        {(fastOn || ultracodeOn) && (
          <span className={css.triggerTags}>
            {fastOn && <Tag tone="neutral" className={css.triggerTag}>{t('trigger.fast')}</Tag>}
            {ultracodeOn && <Tag tone="neutral" className={css.triggerTag}>{effortLabel === undefined ? t('trigger.ultracode') : t('trigger.ultracodeEffort', { effort: effortLabel })}</Tag>}
          </span>
        )}
        {busy
          ? <StateDot state="ongoing" />
          : <IconChevronDownOutlineRegular className={clsx(css.chevron, open && css.chevronOpen)} />}
      </button>

      {/* Portaled to body (Menu primitive's portal mode) so the sidebar and
          column overflow clips cannot crop the card; synthetic events still
          bubble through this React subtree, keeping onKeyDown/onBlur live. */}
      {open && createPortal(
        <MenuSurface
          ref={menuRef}
          id={`${id}-menu`}
          className={css.menu}
          style={menuPos ?? MEASURE_STYLE}
          role={pane === 'model' ? 'group' : 'menu'}
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { drill('model') }}>
                <span className={css.cellLabel}>{t('menu.model')}</span>
                <span className={css.cellValue}>
                  {currentChoice === undefined ? modelLabel : renderModelLabel(currentChoice.group.provider, currentChoice.model, 'menu', true)}
                </span>
                <IconChevronRightOutlineRegular className={css.cellChevron} />
              </button>
              {reasoning !== undefined && (
                <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { drill('effort') }}>
                  <span className={css.cellLabel}>{t('menu.effort')}</span>
                  <span className={css.cellValue}>{effortLabel}</span>
                  <IconChevronRightOutlineRegular className={css.cellChevron} />
                </button>
              )}
              <CliTerminalEntries t={t} probe={cliProfiles} onPick={(profile) => {
                close()
                openCliTerminal(profile).catch((error: unknown) => {
                  announce({ code: 'session/create', message: error instanceof Error ? error.message : String(error) })
                })
              }} />
              <div className={css.footnote}>{t('menu.saved')}</div>
            </>
          )}

          {pane === 'model' && (
            <>
              {subagentSetupOn && (
                <div className={css.subagentNotice} role="note">
                  <span className={css.note}>{t('subagentSetup.notice')}</span>
                  <button type="button" className={css.subagentLink} onClick={() => { close(); openSubagentSetup?.() }}>{t('subagentSetup.open')}</button>
                </div>
              )}
              {showSearch && <div className={css.searchRow}>
                <Input
                  ref={searchRef}
                  className={clsx(css.search, query !== '' && css.searchWithQuery)}
                  type="text"
                  role="searchbox"
                  aria-label={t('search.placeholder')}
                  aria-controls={`${id}-models`}
                  aria-activedescendant={activeModelIndex < 0 ? undefined : `${id}-model-${activeModelIndex}`}
                  placeholder={t('search.placeholder')}
                  value={query}
                  readOnly={busy}
                  onChange={(event) => { changeQuery(event.target.value) }}
                />
                {query !== '' && (
                  <button
                    type="button"
                    className={css.searchClear}
                    aria-label={t('search.clear')}
                    disabled={busy}
                    onClick={() => {
                      changeQuery('')
                      searchRef.current?.focus()
                    }}
                  >
                    <IconCloseFillRegular />
                  </button>
                )}
              </div>}
              {groups.length > 1 && (
                <div className={css.filters} role="group" aria-label={t('filter.aria')}>
                  {[{ id: null, name: t('filter.all') }, ...groups.map(group => ({ id: group.id, name: group.provider.name }))].map(filter => (
                    <Pill
                      key={filter.id ?? ''}
                      className={css.chip}
                      active={providerFilter === filter.id}
                      aria-pressed={providerFilter === filter.id}
                      onClick={() => { setProviderFilter(filter.id) }}
                      onFocus={(event) => { event.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' }) }}
                    >
                      {filter.name}
                    </Pill>
                  ))}
                </div>
              )}
              {state.status === 'loading' && (
                <div className={css.status}>{t('status.loading')}</div>
              )}
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              )}
              {state.failures.map(failure => (
                <div className={css.warning} key={failure.id}>
                  <span>{t('warning.groupLoad', { name: failure.id === 'deepseek-account' ? t('provider.account') : failure.name, message: failure.message })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              ))}
              <div
                ref={groupsRef}
                id={`${id}-models`}
                className={clsx(css.groups, 'scrollable')}
                role="menu"
                aria-label={t('menu.model')}
                hidden={filteredSections.length === 0 && !unroutedCurrent}
              >
                {unroutedCurrent && (
                  <MenuGroup label={t('current.title')}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked="true"
                      className={clsx(css.option, css.selected)}
                      title={modelTitle}
                      disabled
                    >
                      <span className={css.optionCopy}>
                        <span className={css.modelName}>{modelLabel}</span>
                        <span className={css.modelMeta} aria-hidden="true">{t('current.unavailable')}</span>
                      </span>
                      <span className={css.check}><IconCheckOutlineRegular /></span>
                    </button>
                  </MenuGroup>
                )}
                {filteredSections.map(section => (
                  <MenuGroup key={section.key} label={section.label}>
                    {section.rows.map(({ group, model }) => {
                      const index = modelIndex++
                      const selected = shown?.provider === group.id && shown.model === model.id
                      const favorite = favoriteSet.has(rowId(group.id, model.id))
                      const description = descriptionOf(group.id, model, t)
                      const favoriteLabel = favorite ? t('favorite.remove', { model: model.name }) : t('favorite.add', { model: model.name })
                      return (
                        <div className={css.optionRow} key={`${section.key}/${model.id}`}>
                          <button
                            ref={itemRef()}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            id={`${id}-model-${index}`}
                            tabIndex={showSearch ? -1 : 0}
                            onFocus={() => { setHighlightedIndex(index) }}
                            data-highlighted={index === activeModelIndex ? '' : undefined}
                            className={clsx(
                              css.option, css.modelOption, selected && css.selected, index === activeModelIndex && css.optionActive,
                            )}
                            onMouseMove={busy || index === activeModelIndex ? undefined : () => {
                              if (showSearch) setHighlightedIndex(index)
                              else itemRefs.current[index]?.focus()
                            }}
                            title={model.name}
                            disabled={busy || subagentSetupOn}
                            onClick={() => { choose(selectionFor(group.id, model)) }}
                          >
                            <span className={css.optionCopy}>
                              <span className={css.modelName}>{renderModelLabel(group.provider, model, 'option', selected)}</span>
                              {description !== undefined && <span className={css.modelMeta} title={description} aria-hidden="true">{description}</span>}
                            </span>
                            <span className={css.check}>
                              {pending?.provider === group.id && pending.model === model.id
                                ? <StateDot state="ongoing" />
                                : selected ? <IconCheckOutlineRegular /> : null}
                            </span>
                          </button>
                          <button
                            type="button"
                            className={css.favorite}
                            aria-label={favoriteLabel}
                            aria-pressed={favorite}
                            title={favoriteLabel}
                            disabled={busy}
                            onClick={() => { toggleFavorite(rowId(group.id, model.id)) }}
                          >
                            <StarIcon filled={favorite} />
                          </button>
                        </div>
                      )
                    })}
                  </MenuGroup>
                ))}
              </div>
              {state.status === 'ready' && filteredSections.length === 0 && (
                <div className={css.empty} role="status">{t(choices.length === 0 ? 'empty.models' : 'search.empty')}</div>
              )}
            </>
          )}

          {pane === 'effort' && (
            <div className={clsx(css.groups, 'scrollable')}>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
                </div>
              )}
              {effortChoices.length === 0
                ? <div className={css.empty}>{effortsUnknown ? t('empty.effortsUnavailable') : t('empty.efforts')}</div>
                : effortChoices.map((level) => {
                  const checked = level.ultracode === true ? ultracodeOn : !ultracodeOn && effectiveEffort === level.effort
                  return (
                    <button
                      ref={itemRef()}
                      type="button"
                      role="menuitemradio"
                      aria-checked={checked}
                      className={clsx(css.option, checked && css.selected)}
                      title={level.ultracode === true ? t('runOptions.ultracodeCaption') : undefined}
                      key={level.key}
                      disabled={busy || (effortLocked && level.ultracode !== true)}
                      onClick={() => { chooseEffort(level) }}
                    >
                      <span className={css.optionCopy}>
                        <span className={css.modelName}>{level.label}</span>
                      </span>
                      <span className={css.check}>
                        {pending !== null && pending.provider === state.current?.provider
                          && pending.model === state.current.model && pending.reasoningEffort === level.effort
                          ? <StateDot state="ongoing" />
                          : checked ? <IconCheckOutlineRegular /> : null}
                      </span>
                    </button>
                  )
                })}
              {runOptionsWritable && claudeCodeRunOptions && (
                <div className={clsx(css.section, css.divided)}>
                  <div className={css.sectionLabel}>{t('runOptions.title')}</div>
                  <div className={css.toggle}>
                    <span className={css.toggleCopy}>
                      <span className={css.toggleName}>{t('runOptions.fastMode')}</span>
                      <span className={css.caption}>{t('runOptions.fastModeCaption')}</span>
                    </span>
                    <Switch
                      checked={runOptionsCurrent.fastMode === true}
                      label={t('runOptions.fastMode')}
                      onChange={() => { writeRunOptions({ fastMode: runOptionsCurrent.fastMode !== true }) }}
                    />
                  </div>
                  <div className={css.toggleName} id={`${id}-claude-effort`}>{t('runOptions.effort')}</div>
                  <div
                    className={css.effort}
                    role="radiogroup"
                    aria-labelledby={`${id}-claude-effort`}
                    style={{ '--effort-cols': 3 } as CSSProperties}
                  >
                    {[[undefined, 'runOptions.effortDefault'] as const, ...CLAUDE_EFFORTS].map(([effort, key]) => (
                      <button
                        key={effort ?? 'default'}
                        type="button"
                        role="radio"
                        data-run-option=""
                        aria-checked={runOptionsCurrent.effort === effort}
                        className={css.segment}
                        title={t(key)}
                        onClick={() => { writeRunOptions({ effort }) }}
                      >
                        <span className={css.segmentLabel}>{t(key)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </MenuSurface>,
        document.body,
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
