/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * One popover: a model list on the left (search, provider chips, provider
 * groups) and an effort, run-option and footer column on the right. The
 * trigger shows the model name, its effort, and Fast or Ultracode tags while
 * those run options are on. While open, ↑/↓ move focus across model rows,
 * effort levels and switches, wrapping; Tab settles a model row or effort
 * level; Escape and Shift+Tab close back to the trigger. Data and submission
 * ride the SAME per-session ModelDirectory as the /model popup. A rejected
 * selection announces through the shared transient Toast anchored to the
 * composer card; the in-menu strip with Retry remains the catalog-load surface.
 * While the directory's pending selection is unsettled, the trigger shows a
 * spinner in place of its chevron, and each row whose value that selection
 * carries shows one in place of its check mark.
 */
import { MenuSurface, Pill, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type FocusEvent,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionRunOptions, SessionRunOptionsProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular,
  IconDataOutlineRegular, IconWarningOutlineRegular, StateDot, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelKey } from './locales.ts'
import type { ModelSelectInjected } from './slots.ts'
import { descriptionOf } from './descriptions.ts'
import css from './ModelSelect.module.css'
import { CliTerminalEntries } from './CliTerminalEntries.tsx'
import { subagentLockOf } from './subagent-lock.ts'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  ultracode?: boolean
}

const ROW_SELECTOR = '[role="menuitemradio"], [role="radio"], [role="switch"]'

/** Keyboard-walkable controls of the open card, in DOM order. */
function rowsOf(menu: HTMLElement | null): HTMLButtonElement[] {
  return [...menu?.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR) ?? []]
}

/** Focus the checked model row, else the first enabled row, else the trigger. */
function focusCurrentRow(menu: HTMLElement | null, trigger: HTMLElement | null): void {
  const checked = menu?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not(:disabled)')
  ;(checked ?? rowsOf(menu).find(row => !row.disabled) ?? trigger)?.focus()
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
 * @returns the trigger and, while open, the popover.
 */
export function ModelSelect(
  { locked, useProjection, available, useModelDirectory, load, select, useModelFavorites, toggleFavorite, setRunOptions, openCliTerminal,
    cliProfiles, openSubagentSetup, useGlobalSetup, t }:
  Pick<PropsRuntime<'conversation.input.model'>, 'locked' | 'useProjection'> & InjectFace<ModelSelectInjected> & PropsLocale<'model'>,
) {
  const state = useModelDirectory(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState<string | null>(null)
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
  const menuRef = useRef<HTMLDivElement | null>(null)
  const focusRowOnOpen = useRef(false)
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null)
  const id = useId()

  const groups = useMemo(() => state.groups.toSorted((left, right) =>
    (left.id === 'deepseek-account' ? 0 : left.id === 'deepseek-official' ? 1 : 2)
      - (right.id === 'deepseek-account' ? 0 : right.id === 'deepseek-official' ? 1 : 2)), [state.groups])
  const choices = useMemo(() => groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      key: `${group.id}/${model.id}`,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [groups])
  const visibleGroups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const matches = (choice: typeof choices[number]): boolean => query === ''
      || choice.model.name.toLocaleLowerCase().includes(query)
      || choice.model.id.toLocaleLowerCase().includes(query)
      || choice.group.name.toLocaleLowerCase().includes(query)
    if (providerFilter !== null) {
      return groups.filter(group => group.id === providerFilter).map(group => ({
        key: group.id,
        name: group.name,
        models: choices.filter(choice => choice.group.id === group.id && matches(choice)),
      })).filter(group => group.models.length > 0)
    }
    const favorites = choices.filter(choice => favoriteSet.has(choice.key) && matches(choice))
    const providerGroups = groups.map(group => ({
      key: group.id,
      name: group.name,
      models: choices.filter(choice => choice.group.id === group.id
        && !favoriteSet.has(choice.key) && matches(choice)),
    })).filter(group => group.models.length > 0)
    return favorites.length === 0
      ? providerGroups
      : [{ key: 'favorites', name: t('favorites.title'), models: favorites }, ...providerGroups]
  }, [choices, favoriteSet, search, groups, t, providerFilter])
  const visibleChoices = visibleGroups.flatMap(group => group.models)
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
        ? [{ key: 'ultracode', effort: reasoning.efforts.at(-1)?.id, label: t('runOptions.ultracode'), ultracode: true }]
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

  useEffect(() => {
    if (!open || !focusRowOnOpen.current) return
    focusRowOnOpen.current = false
    focusCurrentRow(menuRef.current, triggerRef.current)
  }, [open])

  // Portaled placement (the Menu primitive's portal rules: fixed from the
  // anchor rect, measured before paint, clamped inside the viewport): above
  // the trigger, right edges aligned. Depends on the filters and directory
  // state because they resize the card.
  /* jscpd:ignore-start -- deliberate mirror of ui-primitives useAnchoredPosition:
     that hook only places from the anchor's LEFT edge, while this card aligns
     right edges (x = rect.right - width), so the measure-and-clamp plumbing repeats. */
  useLayoutEffect(() => {
    if (!open) { setMenuPos(null); return }
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
    // First run measures the hidden pre-render (same commit as `open`), so
    // the card lands placed before anything paints.
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, state, search, providerFilter, favoriteIds])
  /* jscpd:ignore-end */

  if (!available) return null

  const show = (): void => {
    setSearch('')
    setProviderFilter(null)
    triggerRef.current?.focus()
    focusRowOnOpen.current = state.current === null
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = rowsOf(menuRef.current).filter(item => !item.disabled)
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
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close(true)
      return
    }
    if (!open) return
    if (event.key === 'Tab') {
      if (event.shiftKey) {
        event.preventDefault()
        close(true)
        return
      }
      const focused = document.activeElement
      const role = focused?.getAttribute('role')
      // Run-option controls (switches, Claude Code effort) apply on click; Tab leaves them instead of settling like a model row.
      if ((role === 'switch' || focused?.hasAttribute('data-run-option') === true) && menuRef.current?.contains(focused) === true) {
        event.preventDefault()
        close(true)
        return
      }
      if (focused instanceof HTMLButtonElement && (role === 'menuitemradio' || role === 'radio') && menuRef.current?.contains(focused) === true) {
        event.preventDefault()
        focused.click()
        return
      }
      if (focused !== triggerRef.current) return
      event.preventDefault()
      focusCurrentRow(menuRef.current, triggerRef.current)
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
      if (rootRef.current !== null) close(true)
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
    triggerRef.current?.focus()
    void select(selection).then(settleSelection)
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    submit(selection)
  }

  const chooseEffort = (level: EffortChoice): void => {
    if (state.current === null) return
    const ultracode = level.ultracode === true
    if (ultracode !== ultracodeOn) writeRunOptions({ ultracode })
    if (effortLocked || effectiveEffort === level.effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...level.effort === undefined ? {} : { reasoningEffort: level.effort },
    }
    submit(selection)
  }

  const waiting = shown === null && state.status === 'loading'
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
        // WebKit blurs a focused control before click unless mousedown keeps focus; the search field keeps its caret.
        if (event.target instanceof Element && event.target.closest('input') === null) event.preventDefault()
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
        <span className={css.triggerLabel}>{modelLabel}</span>
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
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          <div className={css.body}>
            <div className={css.list}>
              {subagentSetupOn && (
                <div className={css.subagentNotice} role="note">
                  <span className={css.note}>{t('subagentSetup.notice')}</span>
                  <button type="button" className={css.subagentLink} onClick={() => { close(); openSubagentSetup?.() }}>{t('subagentSetup.open')}</button>
                </div>
              )}
              <input
                className={css.search}
                type="search"
                placeholder={t('search.placeholder')}
                aria-label={t('search.aria')}
                value={search}
                onChange={(event) => { setSearch(event.currentTarget.value) }}
              />
              {groups.length > 1 && (
                <div
                  className={css.filters}
                  role="group"
                  aria-label={t('filter.aria')}
                >
                  {[{ id: null, name: t('filter.all') }, ...groups.map(group => ({
                    id: group.id, name: group.id === 'deepseek-account' ? t('provider.account') : group.name,
                  }))].map(filter => (
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
              <div className={clsx(css.groups, 'scrollable')}>
                {unroutedCurrent && (
                  <section role="group" aria-labelledby={`${id}-current`} className={css.group}>
                    <div className={css.groupTitle} id={`${id}-current`}>{t('current.title')}</div>
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
                  </section>
                )}
                {visibleGroups.map((group) => {
                  const headingId = `${id}-${group.key}`
                  return (
                    <section role="group" aria-labelledby={headingId} className={css.group} key={group.key}>
                      <div className={css.groupTitle} id={headingId}>{group.key === 'deepseek-account' ? t('provider.account') : group.name}</div>
                      {group.models.map((choice) => {
                        const selected = shown?.provider === choice.group.id && shown.model === choice.model.id
                        const favorite = favoriteSet.has(choice.key)
                        const description = descriptionOf(choice.group.id, choice.model, t)
                        return (
                          <div className={css.optionRow} key={choice.key}>
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              className={clsx(css.option, selected && css.selected)}
                              title={choice.model.name}
                              disabled={busy || subagentSetupOn}
                              onClick={() => { choose(choice.selection) }}
                            >
                              <span className={css.optionCopy}>
                                <span className={css.modelName}>{choice.model.name}</span>
                                {description !== undefined && <span className={css.modelMeta} title={description} aria-hidden="true">{description}</span>}
                              </span>
                              <span className={css.check}>
                                {pending?.provider === choice.group.id && pending.model === choice.model.id
                                  ? <StateDot state="ongoing" />
                                  : selected ? <IconCheckOutlineRegular /> : null}
                              </span>
                            </button>
                            <button
                              type="button"
                              className={css.favorite}
                              aria-label={favorite
                                ? t('favorite.remove', { model: choice.model.name })
                                : t('favorite.add', { model: choice.model.name })}
                              aria-pressed={favorite}
                              title={favorite
                                ? t('favorite.remove', { model: choice.model.name })
                                : t('favorite.add', { model: choice.model.name })}
                              disabled={busy}
                              onClick={() => { toggleFavorite(choice.key) }}
                            >
                              <StarIcon filled={favorite} />
                            </button>
                          </div>
                        )
                      })}
                    </section>
                  )
                })}
                {state.status === 'ready' && choices.length === 0 && (
                  <div className={css.empty}>{t('empty.models')}</div>
                )}
                {state.status === 'ready' && choices.length > 0 && visibleChoices.length === 0 && (
                  <div className={css.empty}>{t('empty.search')}</div>
                )}
              </div>
            </div>
            <div className={css.side}>
              <div className={css.section}>
                <div className={css.sectionLabel} id={`${id}-effort`}>{t('effort.title')}</div>
                {effortChoices.length === 0
                  ? <>
                    <div className={css.note}>{effortsUnknown ? t('empty.effortsUnavailable') : t('empty.efforts')}</div>
                    {effortsUnknown && state.retainedEffort !== undefined && <div className={css.note}>{state.retainedEffort}</div>}
                  </>
                  : <>
                    <div
                      className={css.effort}
                      role="radiogroup"
                      aria-labelledby={`${id}-effort`}
                      style={{ '--effort-cols': effortChoices.length > 4 ? Math.ceil(effortChoices.length / 2) : effortChoices.length } as CSSProperties}
                    >
                      {effortChoices.map(level => (
                        <button
                          key={level.key}
                          type="button"
                          role="radio"
                          aria-checked={level.ultracode === true ? ultracodeOn : !ultracodeOn && effectiveEffort === level.effort}
                          className={css.segment}
                          title={level.ultracode === true ? t('runOptions.ultracodeCaption') : level.label}
                          disabled={busy || (effortLocked && level.ultracode !== true)}
                          onClick={() => { chooseEffort(level) }}
                        >
                          {pending !== null && pending.provider === shown?.provider
                            && pending.model === shown.model && pending.reasoningEffort === level.effort
                            ? <StateDot state="ongoing" />
                            : null}
                          <span className={css.segmentLabel}>{level.label}</span>
                        </button>
                      ))}
                    </div>
                    <div className={css.scale} aria-hidden="true">
                      <span>{t('effort.faster')}</span>
                      <span>{t('effort.smarter')}</span>
                    </div>
                  </>}
              </div>
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
              <CliTerminalEntries t={t} probe={cliProfiles} onPick={(profile) => {
                setOpen(false)
                openCliTerminal(profile).catch((error: unknown) => {
                  announce({ code: 'session/create', message: error instanceof Error ? error.message : String(error) })
                })
              }} />
              <div className={css.footnote}>{t('menu.saved')}</div>
            </div>
          </div>
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
