import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import css from './RoleModelPicker.module.css'

/** One pickable entry: a model, or a special choice such as "Not configured". */
export interface RolePickerOption {
  value: string
  label: string
  /** Group heading the option sits under; options without one lead the list. */
  group?: string
  /** Extra words matched by the search but never shown. */
  keywords?: string
}

/** Props of the searchable role model picker. */
export interface RoleModelPickerProps {
  id: string
  label: string
  value: string
  options: readonly RolePickerOption[]
  searchPlaceholder: string
  emptyText: string
  onChange: (value: string) => void
}

/**
 * Keep the options whose label, group or keywords contain every word of the query.
 * @param options - all pickable options.
 * @param query - the search text.
 * @returns the matching options in their original order.
 */
export function filterRoleOptions(options: readonly RolePickerOption[], query: string): readonly RolePickerOption[] {
  const words = query.toLowerCase().split(/\s+/u).filter(word => word !== '')
  if (words.length === 0) return options
  return options.filter((option) => {
    const haystack = `${option.label} ${option.group ?? ''} ${option.keywords ?? ''}`.toLowerCase()
    return words.every(word => haystack.includes(word))
  })
}

/**
 * Render a combobox button that opens a searchable, keyboard-navigable listbox.
 * @param props - the selected value, options and change callback.
 * @returns the picker.
 */
export function RoleModelPicker({
  id, label, value, options, searchPlaceholder, emptyText, onChange,
}: RoleModelPickerProps) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const visible = useMemo(() => filterRoleOptions(options, query), [options, query])
  const selected = options.find(option => option.value === value)

  useEffect(() => {
    if (!open) return undefined
    search.current?.focus()
    const close = (event: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => { document.removeEventListener('mousedown', close) }
  }, [open])

  const openList = (): void => {
    setQuery('')
    setActive(Math.max(0, options.findIndex(option => option.value === value)))
    setOpen(true)
  }

  const close = (): void => {
    setOpen(false)
    trigger.current?.focus()
  }

  const pick = (option: RolePickerOption | undefined): void => {
    if (option === undefined) return
    if (option.value !== value) onChange(option.value)
    close()
  }

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    const last = visible.length - 1
    if (event.key === 'ArrowDown') setActive(index => Math.min(last, index + 1))
    else if (event.key === 'ArrowUp') setActive(index => Math.max(0, index - 1))
    else if (event.key === 'Home') setActive(0)
    else if (event.key === 'End') setActive(Math.max(0, last))
    else if (event.key === 'Enter') pick(visible[active])
    else if (event.key === 'Escape') close()
    else if (event.key !== 'Tab') return
    if (event.key === 'Tab') setOpen(false)
    else event.preventDefault()
  }

  let lastGroup: string | undefined
  return (
    <div ref={root} className={css.root}>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        className={css.trigger}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => { if (open) setOpen(false); else openList() }}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            openList()
          }
        }}
      >
        <span className={css.value}>{selected?.label ?? ''}</span>
        <span className={css.caret} aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={css.popover}>
          <input
            ref={search}
            type="search"
            className={css.search}
            aria-label={searchPlaceholder}
            aria-controls={listId}
            aria-activedescendant={visible[active] === undefined ? undefined : `${listId}-${active}`}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0) }}
            onKeyDown={onSearchKey}
          />
          <ul id={listId} role="listbox" aria-label={label} className={css.list}>
            {visible.map((option, index) => {
              const heading = option.group !== undefined && option.group !== lastGroup ? option.group : undefined
              lastGroup = option.group
              return (
                <li key={option.value} role="presentation">
                  {heading !== undefined && <div className={css.group} role="presentation">{heading}</div>}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={option.value === value}
                    data-active={index === active ? 'true' : undefined}
                    className={css.option}
                    onMouseEnter={() => { setActive(index) }}
                    onClick={() => { pick(option) }}
                  >
                    {option.label}
                  </div>
                </li>
              )
            })}
            {visible.length === 0 && <li role="presentation" className={css.empty}>{emptyText}</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
