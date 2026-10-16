/** @module Knowledge workspace values crossing the Host RPC connection. */
export type { MemorixCell, MemorixPage, MemorixTable, MemorixView } from '@deepseek-ai/dsh-knowledge-router/memorix-types'

/** Official Graphify HTML generated from the selected graph export. */
export interface MemoryGraph {
  html: string
  path: string
  /** Imported document chunks in the store; 0 means no graph was built and `html` is empty. */
  documents: number
}
/** Provider-confirmed document import outcome. */
export interface MemoryImportResult { filename: string; originalPath: string; completed: number; total: number; error: string | null }
/** One failed automatic memory action and when it failed. */
export interface MemoryFailure { message: string; at: string }
/** Outcome of the latest automatic chat saves and recall in this Host run; a success clears that action's failure. */
export interface MemoryActivity {
  lastSavedAt?: string | undefined
  saveFailure?: MemoryFailure | undefined
  lastRecalledAt?: string | undefined
  recallFailure?: MemoryFailure | undefined
}
/** Automatic chat memory switch, Memorix state and the latest outcomes shown on the Memory page. */
export interface MemoryStatus extends MemoryActivity {
  chatMemory: boolean
  /** `ready` once the Memorix client is connected, `starting` while it connects, `unavailable` when it failed or is not mounted. */
  server: 'ready' | 'starting' | 'unavailable'
  /** Why Memorix is unavailable; absent otherwise. */
  connection?: string | undefined
}
