/** Validate workspace-change records that cross the Host routes and address their summary, comparison, and native-open actions. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { WorkspaceChangedFile, WorkspaceChangesSummary, WorkspaceDiffHunk, WorkspaceFileDiff, WorkspaceStatusFile } from '@deepseek-ai/dsh-workspace-changes/types'

/** Authenticated GET route serving one announced change summary while its Session lives. */
export const CHANGED_FILES_PATH = '/api/changes.summary'

/** Authenticated GET route serving one listed file's turn-start and turn-end comparison while its Session lives. */
export const CHANGES_DIFF_PATH = '/api/changes.diff'

/** Authenticated POST route for opening a changed file on the Host desktop. */
export const CHANGES_OPEN_PATH = '/api/changes.open'

/** Authenticated GET route serving current git status for one registered Workspace. */
export const WORKSPACE_STATUS_PATH = '/api/workspace.status'

/** Authenticated GET route serving one current git comparison for a registered Workspace. */
export const WORKSPACE_DIFF_PATH = '/api/workspace.diff'

/** Resource-address prefix of a turn's review tab in the right Sidebar. */
export const CHANGES_REVIEW_ADDRESS = 'dsh-resource://changes-review/session/'

/** The summary fields the route serves; the Host keeps the working directory and snapshot ids to itself. */
export type ChangesSummary = Pick<WorkspaceChangesSummary, 'turn' | 'files' | 'total' | 'added' | 'deleted'>

/** The comparison the route serves, as the Host computed it. */
export type ChangesDiff = WorkspaceFileDiff

/** Current status fields exposed to the browser without Host paths. */
export interface WorkspaceStatusValue {
  workspaceId: WorkspaceId
  branch?: string
  files: WorkspaceStatusFile[]
  total: number
  added: number
  deleted: number
}

/** Current comparison returned by the workspace diff route. */
export type WorkspaceDiff = WorkspaceFileDiff

/** Coordinates of one turn's review: the viewed Session, the announcing event, and the turn it summarized. */
export interface ChangesReviewCoordinates {
  sessionId: SessionId
  seq: number
  /** The summarized turn, carried for the tab title. */
  turn: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate one changed-file record read from the summary route.
 * @param value - decoded JSON.
 * @returns whether the record carries a path, a display path, and line counts.
 */
export function isChangedFile(value: unknown): value is WorkspaceChangedFile {
  if (!isRecord(value)) return false
  const { path, display, added, deleted, binary, oversized } = value
  return typeof path === 'string' && path.length > 0 && typeof display === 'string' && display.length > 0
    && Number.isSafeInteger(added) && Number.isSafeInteger(deleted)
    && (binary === undefined || binary === true) && (oversized === undefined || oversized === true)
}


/**
 * Validate one current repository status file.
 * @param value - decoded JSON candidate.
 * @returns whether the value is a valid status-file record.
 */
export function isWorkspaceStatusFile(value: unknown): value is WorkspaceStatusFile {
  if (!isRecord(value)) return false
  const { path, display, index, worktree, oldPath, added, deleted, binary } = value
  return typeof path === 'string' && path.length > 0 && typeof display === 'string' && display.length > 0
    && typeof index === 'string' && index.length === 1 && typeof worktree === 'string' && worktree.length === 1
    && (oldPath === undefined || typeof oldPath === 'string')
    && Number.isSafeInteger(added) && Number.isSafeInteger(deleted)
    && (binary === undefined || binary === true)
}

/**
 * Validate current repository status returned by the Host.
 * @param value - decoded JSON candidate.
 * @returns whether the value is a valid Workspace status response.
 */
export function isWorkspaceStatus(value: unknown): value is WorkspaceStatusValue {
  if (!isRecord(value)) return false
  const { workspaceId, branch, files, total, added, deleted } = value
  return typeof workspaceId === 'string' && workspaceId.length > 0
    && (branch === undefined || typeof branch === 'string')
    && Number.isSafeInteger(total) && Number.isSafeInteger(added) && Number.isSafeInteger(deleted)
    && Array.isArray(files) && files.every(isWorkspaceStatusFile)
}
/**
 * Validate a summary read from the summary route.
 * @param value - decoded JSON.
 * @returns whether the value identifies a turn, a complete file list, the total count, and the line totals.
 */
export function isChangesSummary(value: unknown): value is ChangesSummary {
  if (!isRecord(value)) return false
  const { turn, files, total, added, deleted } = value
  return Number.isSafeInteger(turn) && (turn as number) >= 1 && Number.isSafeInteger(total)
    && Number.isSafeInteger(added) && Number.isSafeInteger(deleted)
    && Array.isArray(files) && files.every(isChangedFile)
}

function isHunk(value: unknown): value is WorkspaceDiffHunk {
  if (!isRecord(value)) return false
  const { oldStart, oldLines, newStart, newLines, lines } = value
  return [oldStart, oldLines, newStart, newLines].every(field => Number.isSafeInteger(field) && (field as number) >= 0)
    && Array.isArray(lines) && lines.every(line => typeof line === 'string' && /^[+ -]/.test(line))
}

/**
 * Validate a comparison read from the comparison route.
 * @param value - decoded JSON.
 * @returns whether the value is a text comparison with well-formed hunks, or a binary or oversized refusal.
 */
export function isChangesDiff(value: unknown): value is ChangesDiff {
  if (!isRecord(value)) return false
  const { kind, path, display } = value
  if (typeof path !== 'string' || path.length === 0 || typeof display !== 'string' || display.length === 0) return false
  if (kind === 'binary' || kind === 'oversized') return true
  if (kind !== 'text') return false
  const { before, after, hunks, coarse } = value
  return typeof before === 'boolean' && typeof after === 'boolean' && typeof coarse === 'boolean'
    && Array.isArray(hunks) && hunks.every(isHunk)
}

/**
 * Validate the `workspace/changes` event data read from a Session log.
 * @param value - decoded durable event data.
 * @returns whether the event names a turn.
 */
export function isChangesEvent(value: unknown): value is { turn: number } {
  return isRecord(value) && Number.isSafeInteger(value.turn) && (value.turn as number) >= 1
}

/**
 * Build the authenticated status URL for one registered Workspace.
 * @param workspaceId - registered Workspace identity.
 * @returns same-origin status URL.
 */
export function workspaceStatusUrl(workspaceId: WorkspaceId): string {
  return `${WORKSPACE_STATUS_PATH}?${new URLSearchParams({ workspaceId })}`
}

/**
 * Build the authenticated current-diff URL for one status-file index.
 * @param workspaceId - registered Workspace identity.
 * @param index - status-file index in the current status response.
 * @returns same-origin current-diff URL.
 */
export function workspaceDiffUrl(workspaceId: WorkspaceId, index: number): string {
  return `${WORKSPACE_DIFF_PATH}?${new URLSearchParams({ workspaceId, index: String(index) })}`
}

/**
 * Build authenticated coordinates for the summary one `workspace/changes` event announced.
 * @param sessionId - owning Session.
 * @param seq - event sequence.
 * @returns same-origin summary URL.
 */
export function changesSummaryUrl(sessionId: SessionId, seq: number): string {
  return `${CHANGED_FILES_PATH}?${new URLSearchParams({ sessionId, seq: String(seq) })}`
}

/**
 * Build authenticated coordinates for one listed file's comparison.
 * @param sessionId - owning Session.
 * @param seq - workspace/changes event sequence.
 * @param index - original index in the summary's files array.
 * @returns same-origin comparison URL.
 */
export function changesDiffUrl(sessionId: SessionId, seq: number, index: number): string {
  return `${CHANGES_DIFF_PATH}?${new URLSearchParams({ sessionId, seq: String(seq), index: String(index) })}`
}

/**
 * Build authenticated coordinates for a changed file's native open.
 * @param sessionId - owning Session.
 * @param seq - workspace/changes event sequence.
 * @param index - original index in the summary's files array.
 * @returns same-origin action URL.
 */
export function changedFileUrl(sessionId: SessionId, seq: number, index: number): string {
  return `${CHANGES_OPEN_PATH}?${new URLSearchParams({ sessionId, seq: String(seq), index: String(index) })}`
}

/**
 * The right-Sidebar address of one turn's review. The Session and the event
 * sequence identify the content; the turn rides along for the tab title.
 * @param coordinates - viewed Session, announcing event, and turn.
 * @returns a `dsh-resource://changes-review/session/…` address.
 */
export function changesReviewAddress(coordinates: ChangesReviewCoordinates): string {
  const { sessionId, seq, turn } = coordinates
  return `${CHANGES_REVIEW_ADDRESS}${encodeURIComponent(sessionId)}/${seq}/${turn}`
}

/**
 * Read the coordinates back out of a review address.
 * @param address - a resource address.
 * @returns the coordinates, or undefined for any other address.
 */
export function parseChangesReviewAddress(address: string): ChangesReviewCoordinates | undefined {
  if (!address.startsWith(CHANGES_REVIEW_ADDRESS)) return undefined
  const parts = address.slice(CHANGES_REVIEW_ADDRESS.length).split('/')
  if (parts.length !== 3) return undefined
  const [sessionId, seq, turn] = parts as [string, string, string]
  if (sessionId === '' || !/^\d+$/.test(seq) || !/^[1-9]\d*$/.test(turn)) return undefined
  try {
    return { sessionId: decodeURIComponent(sessionId) as SessionId, seq: Number(seq), turn: Number(turn) }
  } catch {
    // A malformed percent sequence is not an address this package minted.
    return undefined
  }
}
