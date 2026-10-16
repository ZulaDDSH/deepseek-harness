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
/** Observation filter for the memory browser: every row, saved memories only, or imported document chunks only. */
export type MemorixView = 'all' | 'memories' | 'documents'
/** One saved observation returned for session-start recall. */
export interface MemorixRecentObservation {
  title: string
  narrative: string
  createdAt: string
}
/** One stored observation read back by identifier. */
export interface MemorixObservationRecord {
  id: number
  entityName: string
  topicKey: string | null
  title: string
  narrative: string
  createdAt: string
  status: string
}
