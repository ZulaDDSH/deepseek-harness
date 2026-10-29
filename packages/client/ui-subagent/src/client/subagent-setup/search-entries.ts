/** Search entries for the global Orchestrator & Subagents page, so Settings search finds the defaults by plain words. */
import type { SettingsDirectoryEntry } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SubagentKey } from '../locales.ts'

type Translate = (key: SubagentKey) => string

/**
 * Build the global Orchestrator & Subagents page's search entries.
 * @param t - the `subagent` locale reader.
 * @returns the page, roles, GSD and auto responder entries; each opens the page.
 */
export function subagentSearchEntries(t: Translate): SettingsDirectoryEntry[] {
  const keywords = () => t('search.keywords')
  return [
    { id: 'subagent-setup.defaults', section: 'subagent-setup', label: () => t('global.title'), description: () => t('global.intro'), keywords },
    { id: 'subagent-setup.roles', section: 'subagent-setup', label: () => t('search.roles'), description: () => t('search.rolesHelp'), keywords },
    { id: 'subagent-setup.gsd', section: 'subagent-setup', label: () => t('gsd.group'), description: () => t('gsd.help'), keywords },
    { id: 'subagent-setup.auto-responder', section: 'subagent-setup', label: () => t('autoResponder.group'), description: () => t('autoResponder.help'), keywords },
  ]
}
