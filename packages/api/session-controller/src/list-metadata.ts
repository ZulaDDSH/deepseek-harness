/** Persisted Session-list hints; client-visible, so it imports only the client-safe Session types. */
import type { CliTerminalProfileId } from '@deepseek-ai/dsh-session/types'

/** Persisted hints used to summarize a cold Session. */
export interface SessionListMetadata {
  /** Whether the folded prefix contains no turn. */
  readonly blank: boolean
  /** Latest human-authored prompt time in the folded prefix. */
  readonly lastPromptAt: number | null
  /** CLI terminal profile the Session was created for, when it hosts one. */
  readonly cliProfile?: CliTerminalProfileId | undefined
}
