/** Search entries for the General rows contributed by other features, so the Settings search finds them by plain words. */
import type { SettingsDirectoryEntry } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsKey } from './locales.ts'

type Translate = (key: SettingsKey) => string

/** Row id (the `settings.general.item` id, also the scroll anchor) and the locale stem of its search copy. */
const ROWS = [
  ['permission', 'permission'],
  ['language', 'language'],
  ['appearance', 'appearance'],
  ['font-size', 'fontSize'],
  ['transcript-view', 'transcript'],
  ['performance-usage', 'performance'],
  ['link-opening', 'links'],
  ['developer-tools', 'developerTools'],
  ['shortcuts', 'shortcuts'],
  ['composer-enter', 'composerEnter'],
  ['session-log-deepseek', 'sessionLog'],
] as const

/**
 * Build the General section's search entries.
 * @param t - the `settings` locale reader.
 * @param hasRow - whether a row id is registered right now; a row that is not (a feature that is off) is not searchable.
 * @returns one entry per known row.
 */
export function generalSearchEntries(t: Translate, hasRow: (id: string) => boolean): SettingsDirectoryEntry[] {
  return ROWS.map(([anchor, stem]) => ({
    id: `general.${anchor}`,
    section: 'general',
    anchor,
    label: () => t(`index.${stem}.label`),
    description: () => t(`index.${stem}.description`),
    keywords: () => t(`index.${stem}.keywords`),
    when: () => hasRow(anchor),
  }))
}
