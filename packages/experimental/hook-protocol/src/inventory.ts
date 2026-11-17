/** Hook commands and their configuration or runtime loading status. */
import { hookKey } from '@deepseek-ai/dsh-host-plugin-inventory/hook-key'
import type { HookInventoryHandler, HookInventoryReport } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import type { MatcherGroup } from './types.ts'

export { hookKey }
export type { HookInventoryHandler, HookInventoryReport }

/** Allow-list entry that enables every hook in the bridge's config file. */
export const ALL_HOOKS = '*'

/** Decide whether one hook runs.
 * @param key The hook's {@link hookKey}.
 * @param enabled The bridge's `enabledHooks` allow-list.
 * @param overrides Session overrides keyed by hook key.
 * @returns Whether the command runs.
 */
export function hookEnabled(key: string, enabled: readonly string[], overrides: Readonly<Record<string, boolean>> = {}): boolean {
  return overrides[key] ?? (enabled.includes(ALL_HOOKS) || enabled.includes(key))
}

/** Flatten the accepted groups without exposing parser state.
 * @param config Parsed event groups retained by the bridge.
 * @param enabled Keys the bridge runs; every other command is skipped.
 * @param descriptions User-written descriptions keyed by hook key.
 * @returns Commands with their selecting event, optional matcher and enablement.
 */
export function describeHookHandlers(
  config: Record<string, readonly MatcherGroup[]>,
  enabled: readonly string[] = [],
  descriptions: Readonly<Record<string, string>> = {},
): HookInventoryHandler[] {
  return Object.entries(config).flatMap(([event, groups]) => groups.flatMap(group => group.hooks.map((hook) => {
    const key = hookKey(event, group.matcher, hook.command)
    return {
      event, command: hook.command, key, ...group.matcher === undefined ? {} : { matcher: group.matcher },
      ...hookEnabled(key, enabled) ? {} : { disabled: true },
      ...descriptions[key] ? { description: descriptions[key] } : {},
    }
  })))
}
