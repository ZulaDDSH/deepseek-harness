/** Loaded hook configuration reports collected without rereading source files. */
import type { HookDialect, MatcherGroup } from './types.ts'

/** One accepted command and the event and matcher that select it. */
export interface HookInventoryHandler {
  readonly event: string
  readonly matcher?: string
  readonly command: string
}

/** Configuration captured when a hook bridge loads. */
export interface HookInventoryReport {
  readonly dialect: HookDialect
  readonly source: string
  readonly status: 'loaded' | 'failed'
  readonly handlers: readonly HookInventoryHandler[]
  readonly skipped: readonly string[]
  readonly error?: string
}

/** Flatten the accepted groups without exposing parser state.
 * @param config Parsed event groups retained by the bridge.
 * @returns Commands with their selecting event and optional matcher.
 */
export function describeHookHandlers(config: Record<string, readonly MatcherGroup[]>): HookInventoryHandler[] {
  return Object.entries(config).flatMap(([event, groups]) => groups.flatMap(group => group.hooks.map(hook => ({
    event, command: hook.command, ...group.matcher === undefined ? {} : { matcher: group.matcher },
  }))))
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
