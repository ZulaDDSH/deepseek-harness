/** Hook commands and their configuration or runtime loading status. */
import type { HookDialect, MatcherGroup } from './types.ts'

/** One accepted command and the event and matcher that select it. */
export interface HookInventoryHandler {
  readonly event: string
  readonly matcher?: string
  readonly command: string
  /** Stable identity a bridge's `enabledHooks` setting names. */
  readonly key: string
  /** Whether the bridge currently skips this command (not in `enabledHooks`). */
  readonly disabled?: boolean
}

/** Loaded bridge configuration or a read-only external configuration report. */
export interface HookInventoryReport {
  readonly dialect: HookDialect
  readonly source: string
  readonly status: 'loaded' | 'configured' | 'failed'
  readonly handlers: readonly HookInventoryHandler[]
  readonly skipped: readonly string[]
  readonly error?: string
}

/** Identify one command hook across reloads.
 * @param event Hook event name.
 * @param matcher Selecting matcher, when the group has one.
 * @param command Command after substitution.
 * @returns The key stored in a bridge's `enabledHooks` setting.
 */
export function hookKey(event: string, matcher: string | undefined, command: string): string {
  return JSON.stringify([event, matcher ?? null, command])
}

/** Flatten the accepted groups without exposing parser state.
 * @param config Parsed event groups retained by the bridge.
 * @param enabled Keys the bridge runs; every other command is skipped.
 * @returns Commands with their selecting event, optional matcher and enablement.
 */
export function describeHookHandlers(
  config: Record<string, readonly MatcherGroup[]>,
  enabled: readonly string[] = [],
): HookInventoryHandler[] {
  return Object.entries(config).flatMap(([event, groups]) => groups.flatMap(group => group.hooks.map((hook) => {
    const key = hookKey(event, group.matcher, hook.command)
    return {
      event, command: hook.command, key, ...group.matcher === undefined ? {} : { matcher: group.matcher },
      ...enabled.includes(key) ? {} : { disabled: true },
    }
  })))
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Collect configuration snapshots from currently mounted hook bridges.
     * @mode emit
     * @param reports Mutable destination for loaded bridge reports.
     */
    'hooks/inventory'(reports: HookInventoryReport[]): void
  }
}
