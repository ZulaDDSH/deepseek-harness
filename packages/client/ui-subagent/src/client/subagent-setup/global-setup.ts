/** The Host settings section that stores the global default Subagent Setup, read and written by the setup view. */
import type { SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SetupSource } from './SubagentSetupView.tsx'
import type { SubagentSetup } from '@deepseek-ai/dsh-api-session-controller/client'

/** Settings namespace of the Session Controller entry that owns the global default. */
export const GLOBAL_SETUP_NS = 'session-controller'

/** Fields of the global default namespace this view reads and writes. */
export interface GlobalSetupSection {
  subagentSetup?: unknown
}

/**
 * Observe the stored global default as a setup source.
 * @param scope - the Host settings form of the global default namespace.
 * @returns the stored value, undefined when no global default is set.
 */
export function globalSetupSource(scope: SettingsFormScope<GlobalSetupSection>): SetupSource<unknown> {
  return {
    getSnapshot: () => scope.getSnapshot().value?.subagentSetup,
    subscribe: listener => scope.subscribe(listener),
  }
}

/**
 * Store the global default as one revision-fenced settings edit.
 * @param scope - the Host settings form of the global default namespace.
 * @param setup - the setup to store.
 * @returns true when the Host accepted the write.
 */
export function writeGlobalSetup(scope: SettingsFormScope<GlobalSetupSection>, setup: SubagentSetup): Promise<boolean> {
  return scope.mutate([{ op: 'set', path: ['subagentSetup'], value: setup }], scope.getSnapshot().revision)
}

/** Settings namespace of the Claude Code provider, which the Host serves only when that provider is composed. */
export const CLAUDE_CODE_NS = 'subagent-claude-code'

const CLAUDE_AVAILABLE = { available: true } as const

/** Observable flag of whether the Host composes the Claude Code provider. */
export interface ClaudeServedFlag extends SetupSource<unknown> {
  /** Record whether the provider's settings namespace is currently served. */
  set(served: boolean): void
}

/**
 * Create the Claude Code availability source the global editor reads, in place of the per-Session projection it has no Session for.
 * @returns a source that reads `{ available: true }` while served and undefined otherwise.
 */
export function createClaudeServedFlag(): ClaudeServedFlag {
  let served = false
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => served ? CLAUDE_AVAILABLE : undefined,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      if (next === served) return
      served = next
      for (const listener of [...listeners]) listener()
    },
  }
}
