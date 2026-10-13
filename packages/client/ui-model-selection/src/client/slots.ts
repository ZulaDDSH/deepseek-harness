/**
 * ModelSelect's injected face. The target 'conversation.input.model' seat is
 * declared (children table) and typed by ui-conversation's composer-bar
 * entry; this package only contributes the single occupant, so no SlotMap
 * merge lives here.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionRunOptions } from '@deepseek-ai/dsh-api-session-controller/types'
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
   * Replace this Session's Claude Code run options (fast mode, ultracode, effort).
   * @param options - the complete run options to store.
   * @returns the Host outcome, or undefined when this Session cannot change them.
   */
  setRunOptions?: ((options: SessionRunOptions) => Promise<RemoteResult<SessionRunOptions> | undefined>) | undefined
}
