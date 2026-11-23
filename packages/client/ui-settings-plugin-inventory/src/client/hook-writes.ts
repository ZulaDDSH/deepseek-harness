type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
type PathOp = { readonly op: 'set'; readonly path: string[]; readonly value: Json } | { readonly op: 'unset'; readonly path: string[] }
type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

export interface HookSettingsRemote {
  describe: () => Promise<Result<{ readonly namespaces: readonly { readonly ns: string; readonly value: unknown; readonly revision: number }[] }>>
  mutate: (ns: string, ops: PathOp[], expectedRevision: number | undefined) => Promise<Result<unknown>>
}

const WILDCARD = '*'
const MAX_ATTEMPTS = 3

function storedKeys(section: unknown): string[] {
  const hooks = (section as { readonly enabledHooks?: unknown } | null | undefined)?.enabledHooks
  return Array.isArray(hooks) ? hooks.filter((key): key is string => typeof key === 'string') : []
}

function failure(operation: string, error: { readonly code: string; readonly message: string }): Error {
  return new Error(`${operation} failed: ${error.code}: ${error.message}`)
}

export function enabledAfterSwitch(stored: readonly string[], visible: readonly string[], keys: readonly string[], on: boolean): string[] {
  if (stored.includes(WILDCARD)) return on ? [WILDCARD] : visible.filter(key => !keys.includes(key))
  const rest = stored.filter(key => !keys.includes(key))
  return on ? [...rest, ...keys.filter(key => !rest.includes(key))] : rest
}

export function enabledAfterEnableAll(stored: readonly string[], visible: readonly string[]): string[] {
  if (stored.includes(WILDCARD)) return [WILDCARD]
  return [...stored, ...visible.filter(key => !stored.includes(key))]
}

export function enabledAfterDisableAll(stored: readonly string[], visible: readonly string[]): string[] {
  if (stored.includes(WILDCARD)) return []
  return stored.filter(key => !visible.includes(key))
}

async function readNamespace(settings: HookSettingsRemote, entryId: string): Promise<{ readonly value: unknown; readonly revision: number }> {
  const described = await settings.describe()
  if (!described.ok) throw failure('settings.describe', described.error)
  const view = described.value.namespaces.find(item => item.ns === entryId)
  if (view === undefined) throw new Error(`settings.describe failed: no namespace ${entryId}`)
  return view
}

export function createHookWrites(settings: HookSettingsRemote): {
  updateEnabledHooks: (entryId: string, next: (stored: readonly string[]) => readonly string[]) => Promise<void>
  setHookDescriptions: (entryId: string, keys: readonly string[], text: string | undefined) => Promise<void>
} {
  return {
    async updateEnabledHooks(entryId, next) {
      for (let attempt = 1; ; attempt++) {
        const view = await readNamespace(settings, entryId)
        const enabled = [...next(storedKeys(view.value))]
        const result = await settings.mutate(entryId, [{ op: 'set', path: ['enabledHooks'], value: enabled }], view.revision)
        if (result.ok) return
        if (result.error.code !== 'settings/conflict' || attempt === MAX_ATTEMPTS) throw failure('settings.mutate', result.error)
      }
    },
    async setHookDescriptions(entryId, keys, text) {
      const value = text?.trim() ?? ''
      const ops: PathOp[] = keys.map(key => value === ''
        ? { op: 'unset', path: ['hookDescriptions', key] }
        : { op: 'set', path: ['hookDescriptions', key], value })
      const result = await settings.mutate(entryId, ops, undefined)
      if (!result.ok) throw failure('settings.mutate', result.error)
    },
  }
}
