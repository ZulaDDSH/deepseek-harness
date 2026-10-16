/**
 * ModelSelect's injected face. The target 'conversation.input.model' seat is
 * declared (children table) and typed by ui-conversation's composer-bar
 * entry; this package only contributes the single occupant, so no SlotMap
 * merge lives here.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionRunOptions } from '@deepseek-ai/dsh-api-session-controller/types'
import type { CliTerminalProfileId } from '@deepseek-ai/dsh-session/types'
import type { CliTerminalStatus } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from './directory.ts'

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
