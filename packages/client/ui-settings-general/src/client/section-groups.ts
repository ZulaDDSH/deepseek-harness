/** Navigation grouping of the Settings pages; sections outside the table gather under "More". */
import type { SettingsKey } from './locales.ts'
import type { SettingsSectionRow } from './shell-contract.ts'

interface GroupSpec {
  id: string
  /** Heading copy; the first group carries none because it is the default landing area. */
  labelKey: SettingsKey | undefined
  /** Section ids in display order. */
  sections: readonly string[]
}

const GROUPS: readonly GroupSpec[] = [
  { id: 'app', labelKey: undefined, sections: ['account', 'general'] },
  { id: 'models', labelKey: 'group.models', sections: ['models', 'jev'] },
  { id: 'agent', labelKey: 'group.agent', sections: ['agent-presets', 'subagent-setup', 'mcp', 'hooks', 'plugins'] },
]

/** One navigation block: an optional heading and its pages. */
export interface NavGroup {
  id: string
  labelKey: SettingsKey | undefined
  rows: readonly SettingsSectionRow[]
}

/**
 * Arrange the registered sections into the navigation groups.
 * @param rows - sections in registration order (already sorted by `order`).
 * @returns non-empty groups; a section the table does not know follows the known groups in `order`, under "More".
 */
export function groupSections(rows: readonly SettingsSectionRow[]): readonly NavGroup[] {
  const known = new Set(GROUPS.flatMap(group => group.sections))
  const groups: NavGroup[] = GROUPS.map(group => ({
    id: group.id,
    labelKey: group.labelKey,
    rows: group.sections.flatMap(id => rows.filter(row => row.id === id)),
  }))
  groups.push({ id: 'other', labelKey: 'group.other', rows: rows.filter(row => !known.has(row.id)) })
  return groups.filter(group => group.rows.length > 0)
}
