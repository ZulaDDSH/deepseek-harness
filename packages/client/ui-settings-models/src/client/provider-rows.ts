import type { LlmNativeAuth } from '@deepseek-ai/dsh-api-remotes/client'
import { deriveKeyRef } from './store.ts'
import type { ModelsSettingsState, ProviderRow } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { ModelPickerOption } from './ProviderEditor.tsx'

/** Provider identity shared by row actions and confirmation copy. */
export interface ProviderIdentity {
  /** Stable provider route id. */
  provider: string
  /** Human-facing provider name. */
  displayName: string
}

/** One existing row or dormant directory entry addressed by an editor action. */
export interface EditorTarget extends ProviderIdentity {
  settingsNs: string
  settingsPath: readonly string[]
  /** Writable credential identified under this page's conventional reference. */
  credentialRef?: string
  /** The adapter reports this route as one it does not ship (see {@link ProviderEditorProps.declared}). */
  declared?: boolean
  defaultBaseURL?: string
  baseURLEnv?: readonly string[]
  nativeAuth?: LlmNativeAuth
}

/**
 * Whether a whole-section provider still needs its first key: an unconfigured
 * credential opens the setup card instead of showing a row. This is the
 * first-run posture alone — a user who can already reach some provider gets an
 * ordinary row with the missing-key dot, since nothing here is blocking them.
 * @param row - the joined provider row.
 * @param anyUsable - whether any joined row can already serve requests.
 * @returns whether to render the setup card.
 */
export function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (anyUsable || row.entry.provider === 'deepseek-account') return false
  if (row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

/**
 * The provider-card seat's credential fact: the reference this page would use
 * for the row — the profile's `apiKeyEnv`, or the page's derived
 * `<ROUTE>_API_KEY` while the profile names none — confirmed configured. The
 * derived half is what keeps the seat consistent with the editor on the
 * add-provider draft, whose dormant row names no reference yet.
 * @param row - the joined provider row.
 * @returns whether the seat's key is confirmed configured.
 */
export function keyConfiguredOf(row: ProviderRow): boolean {
  return row.apiKeyEnv !== undefined
    ? row.credential?.configured === true
    : row.derivedCredential?.configured === true
}

/**
 * The editor target addressing one joined row, carrying its managed credential
 * reference only while that reference is configured and writable.
 * @param row - the joined provider row.
 * @returns the target the editor and the delete confirmation act on.
 */
export function targetOf(row: ProviderRow): EditorTarget {
  const managedRef = deriveKeyRef(row.entry.provider)
  const credentialRef = row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    ? managedRef
    : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...credentialRef === undefined ? {} : { credentialRef },
    // Only declared routes may expose route-owned fields.
    ...row.entry.declared === true ? { declared: true } : {},
    ...row.entry.defaultBaseURL === undefined ? {} : { defaultBaseURL: row.entry.defaultBaseURL },
    ...row.entry.baseURLEnv === undefined ? {} : { baseURLEnv: row.entry.baseURLEnv },
    ...row.entry.nativeAuth === undefined ? {} : { nativeAuth: row.entry.nativeAuth },
  }
}

/**
 * Stable visible and accessible identity for one provider target.
 * @param target - the provider identity.
 * @returns the bare route id, or the display name followed by the route id.
 */
export function providerTargetLabel(target: ProviderIdentity): string {
  return target.provider === target.displayName
    ? target.provider
    : `${target.displayName} (${target.provider})`
}

/**
 * Replace the one provider placeholder in localized destructive-action copy.
 * @param template - the localized copy holding one `{provider}` placeholder.
 * @param target - the provider the copy names.
 * @returns the copy with its placeholder replaced by the target label.
 */
export function providerCopy(template: string, target: ProviderIdentity): string {
  return template.replace('{provider}', () => providerTargetLabel(target))
}

/** Build editable provider and model suggestions from configured namespaces.
 * @param state Current provider rows and settings views.
 * @param schema Settings path reader.
 * @returns Suggestions retaining arbitrary manual provider and model input.
 */
export function providerModelOptions(state: Pick<ModelsSettingsState, 'rows' | 'namespaces' | 'catalog'>, schema: SettingsSchemaOperations): ModelPickerOption[] {
  const options = new Map<string, ModelPickerOption>()
  for (const group of state.catalog ?? []) {
    options.set(group.id, {
      provider: group.id,
      displayName: group.name,
      models: group.models.map(model => model.id),
      efforts: Object.fromEntries(group.models.map(model => [model.id, model.reasoning?.efforts.map(effort => effort.id) ?? []])),
    })
  }
  const configured = state.rows.flatMap((row) => {
    const namespace = state.namespaces.get(row.entry.settingsNs)
    if (namespace === undefined) return []
    const profile = schema.getPath(namespace.value, row.entry.settingsPath)
    const rawModels = schema.getPath(profile, ['models'])
    const models = Array.isArray(rawModels)
      ? rawModels.flatMap((model) => {
        if (typeof model !== 'object' || model === null || Array.isArray(model)) return []
        const id = (model as { id?: unknown }).id
        return typeof id === 'string' && id.length > 0 ? [id] : []
      })
      : []
    return [{ provider: row.entry.provider, displayName: row.entry.displayName, models }]
  })
  for (const option of configured) {
    const known = options.get(option.provider)
    options.set(option.provider, known === undefined
      ? option
      : { ...known, models: [...new Set([...known.models, ...option.models])] })
  }
  return [...options.values()]
}
