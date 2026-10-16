/** Settings search: the rail's input and the result list that replaces the page while a query is typed. */
import type { KeyboardEvent, RefObject } from 'react'
import { IconCloseOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsRootComponentProps } from './shell-contract.ts'
import css from './SettingsSearch.module.css'

/** One thing the user can jump to: a settings page, a single setting, or a page elsewhere in the app. */
export interface SearchResult {
  key: string
  label: string
  description: string
  /** Shown under the label: the page a setting lives in, or the kind of result. */
  crumb: string
  /** Open a settings page (optionally scrolling to one setting), or leave the dialog for another page. */
  target:
    | { kind: 'section'; sectionId: string; anchor: string | undefined }
    | { kind: 'link'; open: () => void }
}

type Translate = SettingsRootComponentProps['t']

/** Props of {@link SearchBox}. */
export interface SearchBoxProps {
  t: Translate
  value: string
  inputRef: RefObject<HTMLInputElement>
  onChange: (value: string) => void
  /** Move focus into the result list. */
  onArrowDown: () => void
  /** Open the best result. */
  onEnter: () => void
}

/**
 * Render the search field. Escape clears a non-empty query without closing the dialog.
 * @param props - value, handlers and copy.
 * @returns the search field.
 */
export function SearchBox({ t, value, inputRef, onChange, onArrowDown, onEnter }: SearchBoxProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape' && value !== '') {
      event.preventDefault()
      onChange('')
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      onArrowDown()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onEnter()
    }
  }
  return (
    <div className={css.box} role="search">
      <span className={css.icon}><IconSearchOutlineRegular size={14} aria-hidden="true" /></span>
      <input
        ref={inputRef}
        className={css.input}
        type="text"
        value={value}
        placeholder={t('search.placeholder')}
        aria-label={t('search.label')}
        aria-keyshortcuts="/"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => { onChange(event.currentTarget.value) }}
        onKeyDown={onKeyDown}
      />
      {value === '' ? null : (
        <button type="button" className={css.clear} aria-label={t('search.clear')}
          onClick={() => { onChange(''); inputRef.current?.focus() }}>
          <IconCloseOutlineRegular size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** Props of {@link SearchResults}. */
export interface SearchResultsProps {
  t: Translate
  query: string
  results: readonly SearchResult[]
  listRef: RefObject<HTMLUListElement>
  onOpen: (result: SearchResult) => void
  onArrowUpFromFirst: () => void
}

/**
 * Render the matches, or the empty state that suggests how to retry.
 * @param props - matches, copy and handlers.
 * @returns the result region.
 */
export function SearchResults({ t, query, results, listRef, onOpen, onArrowUpFromFirst }: SearchResultsProps) {
  const move = (event: KeyboardEvent<HTMLUListElement>): void => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    if (event.key === 'ArrowDown') buttons[Math.min(at + 1, buttons.length - 1)]?.focus()
    else if (event.key === 'ArrowUp') {
      if (at === 0) onArrowUpFromFirst()
      else buttons[at - 1]?.focus()
    } else return
    event.preventDefault()
  }
  return (
    <section className={css.results} aria-label={t('search.results')}>
      <p className={css.count} role="status">
        {results.length === 0 ? '' : t('search.count', { count: String(results.length) })}
      </p>
      {results.length === 0 ? (
        <div className={css.empty}>
          <p className={css.emptyTitle}>{t('search.empty', { query: query.trim() })}</p>
          <p className={css.emptyHint}>{t('search.emptyHint')}</p>
        </div>
      ) : (
        <ul ref={listRef} className={css.list} onKeyDown={move}>
          {results.map(result => (
            <li key={result.key}>
              <button type="button" className={css.result} onClick={() => { onOpen(result) }}>
                <span className={css.label}>{result.label}</span>
                {result.description === '' ? null : <span className={css.description}>{result.description}</span>}
                <span className={css.crumb}>{result.crumb}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
