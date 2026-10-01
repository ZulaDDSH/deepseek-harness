/** @module Knowledge workspace values crossing the Host RPC connection. */
export type { MemorixCell, MemorixPage, MemorixTable } from '@deepseek-ai/dsh-knowledge-router/memorix-types'

/** Official Graphify HTML generated from the selected graph export. */
export interface MemoryGraph { html: string; path: string }
/** Provider-confirmed document import outcome. */
export interface MemoryImportResult { filename: string; originalPath: string; completed: number; total: number; error: string | null }
