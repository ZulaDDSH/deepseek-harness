/** Settings directory: what each settings page lets a user change, so one search can span every section. */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

/** Display text: a plain string, or a thunk re-read on every render so locale switches follow. */
export type SettingsDirectoryText = string | (() => string)

/** A destination outside the Settings dialog, such as another page of the app. */
export interface SettingsDirectoryLink {
  /** Name of the destination, shown under the result where a section name would be. */
  place: SettingsDirectoryText
  /** Show the destination; the Settings shell closes its dialog first. */
  open: () => void
}

/** One searchable setting (or a whole page) contributed by the feature that owns it. */
export interface SettingsDirectoryEntry {
  /** Unique across the directory; registering the same id twice fails at registration. */
  id: string
  /** `settings.section` id the setting lives in; an entry sets exactly one of `section` and `link`. */
  section?: string
  /** Destination outside the Settings dialog; an entry sets exactly one of `section` and `link`. */
  link?: SettingsDirectoryLink
  /** User-facing name shown in the result list and matched first. */
  label: SettingsDirectoryText
  /** One-line plain-language explanation shown under the label and matched. */
  description?: SettingsDirectoryText
  /** Extra search-only words (synonyms, old names) that are never displayed. */
  keywords?: SettingsDirectoryText
  /** `data-settings-entry` value of the element to scroll to once the section opens; omitted opens the section only. */
  anchor?: string
  /** Evaluated on every search; while it returns false the entry is hidden (a row whose feature is not available). */
  when?: () => boolean
}

/** One entry with every text resolved in the current locale. */
export interface SettingsDirectoryItem {
  id: string
  /** Section the result opens, or undefined when it leads elsewhere. */
  section: string | undefined
  /** Destination outside the dialog with its place resolved, or undefined for a section result. */
  link: { place: string; open: () => void } | undefined
  label: string
  description: string
  keywords: string
  anchor: string | undefined
}

function read(text: SettingsDirectoryText | undefined): string {
  return typeof text === 'function' ? text() : text ?? ''
}

/**
 * Resolve an entry's texts in the current locale.
 * @param entry - registered entry.
 * @returns the entry with plain strings.
 */
export function resolveSettingsEntry(entry: SettingsDirectoryEntry): SettingsDirectoryItem {
  return {
    id: entry.id,
    section: entry.section,
    link: entry.link === undefined ? undefined : { place: read(entry.link.place), open: entry.link.open },
    label: read(entry.label),
    description: read(entry.description),
    keywords: read(entry.keywords),
    anchor: entry.anchor,
  }
}

/**
 * Settings-owned registry feeding the Settings search. Features register what
 * their page contains next to the page itself, so a plugin-contributed
 * section is searchable without the shell knowing it.
 */
export class SettingsDirectory extends Service {
  private readonly entries = new Map<string, SettingsDirectoryEntry>()
  private readonly listeners = new Set<() => void>()
  private revision = 0

  /** @param ctx - providing ui-settings context. */
  constructor(ctx: Context) {
    super(ctx, 'settingsDirectory')
  }

  /**
   * Add entries; the caller wraps the disposer in `ctx.effect`.
   * @param entries - entries to add; an id already registered throws and adds nothing.
   * @returns the disposer removing exactly these entries.
   */
  register(entries: readonly SettingsDirectoryEntry[]): () => void {
    const ids = new Set<string>()
    for (const entry of entries) {
      if ((entry.section === undefined) === (entry.link === undefined)) {
        throw new Error(`Settings directory entry '${entry.id}' must set exactly one of section and link`)
      }
      if (this.entries.has(entry.id) || ids.has(entry.id)) {
        throw new Error(`Settings directory entry '${entry.id}' is already registered`)
      }
      ids.add(entry.id)
    }
    for (const entry of entries) this.entries.set(entry.id, entry)
    this.bump()
    return () => {
      let removed = false
      for (const entry of entries) {
        if (this.entries.get(entry.id) !== entry) continue
        this.entries.delete(entry.id)
        removed = true
      }
      if (removed) this.bump()
    }
  }

  /**
   * Read the counter that changes whenever an entry is added or removed.
   * @returns the current change counter.
   */
  getVersion(): number {
    return this.revision
  }

  /**
   * Read every registered entry, for tests and diagnostics.
   * @returns registered entries in registration order.
   */
  list(): readonly SettingsDirectoryEntry[] {
    return [...this.entries.values()]
  }

  /**
   * Find entries for a search box: every whitespace-separated word of the query
   * must occur, case-insensitively, in the label, description or keywords.
   * Label hits outrank keyword hits, which outrank description hits; ties keep
   * registration order.
   * @param query - text typed by the user.
   * @returns matching entries with texts resolved in the current locale, best first; empty for a blank query.
   */
  search(query: string): readonly SettingsDirectoryItem[] {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(word => word.length > 0)
    if (words.length === 0) return []
    const hits: Array<{ item: SettingsDirectoryItem; score: number }> = []
    for (const entry of this.entries.values()) {
      if (entry.when?.() === false) continue
      const item = resolveSettingsEntry(entry)
      const label = item.label.toLocaleLowerCase()
      const keywords = item.keywords.toLocaleLowerCase()
      const description = item.description.toLocaleLowerCase()
      let score = 0
      for (const word of words) {
        const at = label.indexOf(word)
        if (at >= 0) score += at === 0 ? 5 : 3
        else if (keywords.includes(word)) score += 2
        else if (description.includes(word)) score += 1
        else {
          score = -1
          break
        }
      }
      if (score > 0) hits.push({ item, score })
    }
    return hits.sort((a, b) => b.score - a.score).map(hit => hit.item)
  }

  /**
   * Observe additions and removals.
   * @param listener - invoked after each change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private bump(): void {
    this.revision += 1
    for (const listener of [...this.listeners]) listener()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Searchable index of every settings page's contents. */
    settingsDirectory: SettingsDirectory
  }
}
