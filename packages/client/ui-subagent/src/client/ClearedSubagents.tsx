import { useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './SubagentHeaderLineage.module.css'

const STORAGE_PREFIX = 'dsh.subagent.cleared.v1:'

function loadCleared(parentSessionId: SessionId): ReadonlySet<SessionId> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + parentSessionId) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is SessionId => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveCleared(parentSessionId: SessionId, cleared: ReadonlySet<SessionId>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_PREFIX + parentSessionId, JSON.stringify([...cleared]))
  } catch { /* storage full or blocked: clearing lasts for this page only */ }
}

interface CatalogEntryLike {
  id: SessionId
  activity: 'running' | 'inactive'
}

/** Cleared-children view of one parent's catalog: what the menu shows and the footer actions. */
export interface ClearedView<E extends CatalogEntryLike> {
  visible: E[]
  clearable: E[]
  hiddenCount: number
  showCleared: boolean
  clear: () => void
  toggleShowCleared: () => void
}

/**
 * Hide finished children of one parent from the catalog menu; running and current children always show.
 * @param parentSessionId - the catalog's parent Session.
 * @param entries - the parent's direct catalog entries.
 * @param currentSessionId - the open child, kept visible.
 * @returns the visible entries and the clear and reveal actions.
 */
export function useClearedView<E extends CatalogEntryLike>(
  parentSessionId: SessionId,
  entries: readonly E[],
  currentSessionId: SessionId | undefined,
): ClearedView<E> {
  const [cleared, setCleared] = useState(() => loadCleared(parentSessionId))
  const [showCleared, setShowCleared] = useState(false)
  const pinned = (entry: E): boolean => entry.activity === 'running' || entry.id === currentSessionId
  const hidden = entries.filter(entry => cleared.has(entry.id) && !pinned(entry))
  const clearable = entries.filter(entry => !cleared.has(entry.id) && !pinned(entry))
  return {
    visible: showCleared ? [...entries] : entries.filter(entry => !hidden.includes(entry)),
    clearable,
    hiddenCount: hidden.length,
    showCleared,
    clear: () => {
      const next = new Set([...cleared, ...clearable.map(entry => entry.id)])
      saveCleared(parentSessionId, next)
      setCleared(next)
      setShowCleared(false)
    },
    toggleShowCleared: () => { setShowCleared(value => !value) },
  }
}

/**
 * Footer actions under the catalog tree: clear finished children and reveal cleared ones for review.
 * @param props - the cleared view and translator.
 * @returns the footer, or null when there is nothing to clear or reveal.
 */
export function ClearedFooter<E extends CatalogEntryLike>({ view, t }: { view: ClearedView<E>; t: TranslateNS<typeof NS> }) {
  if (view.clearable.length === 0 && view.hiddenCount === 0) return null
  return (
    <div className={css.clearFooter}>
      {view.hiddenCount > 0 && (
        <button type="button" className={css.refresh} onClick={view.toggleShowCleared}>
          {view.showCleared ? t('cleared.hide') : t('cleared.show', { count: view.hiddenCount })}
        </button>
      )}
      {view.clearable.length > 0 && (
        <button type="button" className={css.refresh} onClick={view.clear}>
          {t('cleared.clear', { count: view.clearable.length })}
        </button>
      )}
    </div>
  )
}
