/** Composer model selection injection and inline label extension. */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionRunOptions } from '@deepseek-ai/dsh-api-session-controller/types'
import type { CliTerminalProfileId } from '@deepseek-ai/dsh-session/types'
import type { CliTerminalStatus } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { ModelCatalogModel, ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from './directory.ts'

/** Catalog data for a model name inside the composer's existing controls. */
export interface ModelLabelOwner {
  /** Provider identity and localized display name; contains no connection configuration. */
  provider: Pick<ModelProviderGroup, 'id' | 'name'>
  /** The exact provider's model catalog entry. */
  model: ModelCatalogModel
  /** Trigger caption, root-menu current value, or selectable model row. */
  placement: 'trigger' | 'menu' | 'option'
  /** Whether this provider/model pair is the current selection. */
  selected: boolean
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Non-interactive inline model label; selection controls remain owner-managed.
     * Without a contribution, the badge precedes the catalog name in the trigger
     * and follows it in menus.
     * @example
     * return {
     *   inject: ['slots'],
     *   apply(ctx) {
     *     ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register(
     *       { name: 'conversation.input.model.label' },
     *       ({ provider, model }) => React.createElement('span', { title: provider.name }, model.name),
     *     ))
     *   },
     * }
     */
    'conversation.input.model.label': {
      kind: 'single'
      scope: 'session'
      inline: true
      owner: ModelLabelOwner
    }
  }
}

/** Injected business face of the composer model seat. */
export interface ModelSelectInjected {
  /** Whether this session supports Agent-bound model inspection and selection. */
  available: boolean
  /** Registrant-private observables the renderer binds to `useModelDirectory` and `useModelFavorites`. */
  hooks: {
    /** The session's shared directory store (same instance the /model popup reads). */
    modelDirectory: SnapshotStore<ModelDirectoryState>
    /** Favorite row keys persisted in the browser profile. */
    modelFavorites: SnapshotStore<string[]>
    /** The raw global default Orchestrator & Subagent Setup, which a Session without its own setup inherits. */
    globalSetup: { getSnapshot: () => unknown; subscribe: (listener: () => void) => () => void }
  }
  toggleFavorite: (key: string) => void
  /** Ensure the shared advisory catalog is loaded (errors land on the store). */
  load: () => void
  /**
   * Choose a catalog badge's provider-authored text for the active locale.
   * @param text - the badge's literal text or translations.
   * @returns the text to display.
   */
  resolveText: (text: NonNullable<ModelCatalogModel['badge']>['text']) => string
  /**
   * Select a complete provider/model/reasoning selection.
   * @param selection - model selection and optional adapter-owned effort.
   * @returns the Host outcome, or undefined when this Session cannot select a model.
   */
  select: (selection: ModelSelection) => Promise<RemoteResult<void> | undefined>
  /**
   * Open a new terminal Session that runs one user-run CLI, in this Session's workspace.
   * @param profile - CLI terminal profile the picker entry names.
   * @returns after the new Session is opened in the main pane.
   */
  openCliTerminal: (profile: CliTerminalProfileId) => Promise<void>
  /**
   * Probe which CLI terminal profiles resolve in this Session's execution environment.
   * @param signal - cancels the probe when the picker closes.
   * @returns one status per profile.
   */
  cliProfiles: (signal: AbortSignal) => Promise<readonly CliTerminalStatus[]>
  /**
   * Replace this Session's run options (ultracode, plus fast mode and effort for Claude Code runs).
   * @param options - the complete run options to store.
   * @returns the Host outcome, or undefined when this Session cannot change them.
   */
  setRunOptions?: ((options: SessionRunOptions) => Promise<RemoteResult<SessionRunOptions> | undefined>) | undefined
  /**
   * Open this Session's Orchestrator & Subagent Setup view, where models are chosen while subagent mode is on.
   */
  openSubagentSetup?: (() => void) | undefined
}
