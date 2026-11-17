import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PluginLocalizedMeta } from '@deepseek-ai/dsh-package-manifest'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Local package display metadata, independent of whether the entry is enabled. */
  readonly meta?: PluginLocalizedMeta
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
  /** Current startup failure message; absent when this entry has no failed fiber. */
  readonly diagnostic?: string
}

/** Effective enablement of one preset composition row. */
export type PresetPluginEnablement = boolean | 'conditional'

/** One plugin row an agent preset's composition names. */
export interface AgentPresetPluginRow {
  /** Composition row id, or null when the row declares none. */
  readonly entryId: string | null
  /** Module specifier the row names. */
  readonly moduleName: string
  /** Local package display metadata, independent of whether the preset is mounted. */
  readonly meta?: PluginLocalizedMeta
  /**
   * Effective enablement, including disabled ancestor groups. `'conditional'`
   * marks a `!!js` disabled expression on a composition no session has
   * mounted, which only a Loader context can decide.
   */
  readonly enabled: PresetPluginEnablement
  /** The row's own `!!js` disabled expression, when it carries one. */
  readonly condition?: string
  /** Root-fiber phase when the composition is live; null otherwise. */
  readonly fiberPhase: PluginFiberPhase
}

/** One agent preset's identity and flattened composition in the inventory. */
export interface AgentPresetPluginGroup {
  /** Stable preset id. */
  readonly id: string
  /** Display name the preset published; a reader falls back to the id. */
  readonly name?: string
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean
  /** Why this preset's composition cannot be read; absent when rows answer. */
  readonly broken?: string
  /** Plugin rows in composition order; empty when the preset is broken. */
  readonly rows: readonly AgentPresetPluginRow[]
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  /** Loaded hook bridge reports; command matching remains event-dependent. */
  readonly hooks?: readonly HookInventoryReport[]
  /** Whether this Host exposes persistent current-profile management. */
  readonly managementAvailable?: boolean
  readonly entries: readonly PluginInventoryEntry[]
  /**
   * Per-preset compositions, present only when an agent-preset roster is
   * composed in this deployment.
   */
  readonly agentPresets?: readonly AgentPresetPluginGroup[]
}

/** One accepted command and the event and matcher that select it. */
export interface HookInventoryHandler {
  /** Hook event name whose group holds this command. */
  readonly event: string
  /** Matcher of the holding group, absent when the group has none. */
  readonly matcher?: string
  /** Command text the bridge runs. */
  readonly command: string
  /** Stable identity a bridge's `enabledHooks` setting names. */
  readonly key: string
  /** Whether the bridge currently skips this command (not in `enabledHooks`). */
  readonly disabled?: boolean
  /** User-written description from the bridge's `hookDescriptions` setting. */
  readonly description?: string
}

/** Loaded bridge configuration or a read-only external configuration report. */
export interface HookInventoryReport {
  /** Configuration dialect the file was read under. */
  readonly dialect: 'claude-code' | 'codex'
  /** Path of the hook configuration file this report describes. */
  readonly source: string
  /** Mounted bridge (loaded), read-only external file (configured), or read error (failed). */
  readonly status: 'loaded' | 'configured' | 'failed'
  /** Accepted commands in configuration order; empty when the file failed to read. */
  readonly handlers: readonly HookInventoryHandler[]
  /** Hooks left out of handlers, each as "event: hook type" or "missing command". */
  readonly skipped: readonly string[]
  /** Why the file could not be read; present only when status is failed. */
  readonly error?: string
  /** Settings namespace of the bridge entry that loaded this report. */
  readonly settingsNs?: string
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
