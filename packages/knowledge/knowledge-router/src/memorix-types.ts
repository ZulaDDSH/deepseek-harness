/** @module Platform-neutral Memorix browser values. */
/** SQLite values retain nulls, lossless integer text, and explicit binary encodings. */
export type MemorixCell = string | number | null | { base64: string }
/** One complete page of local provider records. */
export interface MemorixPage {
  table: string
  columns: string[]
  rows: Record<string, MemorixCell>[]
  total: number
  offset: number
  limit: number
}
/** A provider table available to the local memory browser. */
export interface MemorixTable {
  name: string
  columns: string[]
  count: number
}
