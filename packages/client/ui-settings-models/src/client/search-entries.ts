import type { SettingsDirectoryEntry } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelsKey } from './locales.ts'

type Translate = (key: ModelsKey) => string

/** Page id, locale keys of the label and the one-line description, and search-only aliases that are never displayed. */
const ENTRIES = [
  ['models', 'api-key', 'keyInput', 'intro', 'credential token provider openai anthropic deepseek kimi'],
  ['models', 'add-provider', 'add', 'addCatalogHint', 'third-party catalog openai anthropic kimi'],
  ['models', 'custom-api', 'addCustom', 'addCustomHint', 'relay proxy self-hosted base url endpoint openai-compatible'],
] as const satisfies ReadonlyArray<readonly [string, string, ModelsKey, ModelsKey, string]>

/**
 * @param t - the `settings.models` locale reader.
 * @returns one entry per setting; labels and descriptions follow the locale.
 */
export function modelsSearchEntries(t: Translate): SettingsDirectoryEntry[] {
  return ENTRIES.map(([section, name, label, description, keywords]) => ({
    id: `${section}.${name}`,
    section,
    label: () => t(label),
    description: () => t(description),
    keywords,
  }))
}
