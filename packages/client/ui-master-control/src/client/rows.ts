import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** Attention, failure, running, or idle state assigned to a session row. */
export type RowState = 'attention' | 'failed' | 'running' | 'idle'

/** Display projection of a session row in the Master Control roster. */
export interface MasterRow {
  readonly id: string
  readonly title: string
  readonly cwd: string | undefined
  readonly state: RowState
  readonly updatedAt: number
  readonly child: boolean
  readonly archived: boolean
}

const RANK: Record<RowState, number> = { attention: 0, failed: 1, running: 2, idle: 3 }

/**
 * Project and sort session list and status snapshots into master rows.
 * @param list - session list state.
 * @param status - session status snapshot.
 * @param now - current time in epoch milliseconds, used for idle archiving.
 * @param archivedSessionIds - sessions the user or idle archiving has archived.
 * @param activity - latest activity time per session id, in epoch milliseconds.
 * @returns sorted master rows, highest attention first.
 */
export function masterRows(
  list: SessionListState, status: SessionStatusSnapshot, now = Date.now(),
  archivedSessionIds: readonly string[] = [], activity: Readonly<Record<string, number>> = {},
): MasterRow[] {
  const archived = new Set(archivedSessionIds)
  const rows: MasterRow[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined || summary.blank || id.startsWith('master-control-home-')) continue
    const s = status.get(id)
    const running = s?.running ?? summary.running
    const state: RowState = s?.pendingInteraction !== undefined
      ? 'attention'
      : s?.failureUnread === true ? 'failed' : running ? 'running' : 'idle'
    const updatedAt = Math.max(activity[id] ?? 0, summary.updatedAt)
    rows.push({
      id,
      title: summary.displayTitle,
      cwd: summary.cwd,
      state,
      updatedAt,
      child: summary.parentId !== undefined,
      archived: archived.has(id) || (state === 'idle' && now - updatedAt >= 7 * 86_400_000),
    })
  }
  return rows.sort((a, b) => RANK[a.state] - RANK[b.state] || b.updatedAt - a.updatedAt)
}

/** A group of session rows belonging to the same workspace in the Master Control roster. */
export interface MasterGroup {
  readonly key: string
  readonly title: string
  readonly path?: string
  readonly rows: MasterRow[]
}

/**
 * Group master rows by workspace and apply text search and state filters.
 * @param rows - projected master rows.
 * @param workspaces - workspace views.
 * @param query - text filter for title or working directory.
 * @param state - state filter or 'all'.
 * @returns grouped and filtered master rows.
 */
export function groupMasterRows(
  rows: readonly MasterRow[],
  workspaces: readonly WorkspaceView[],
  query: string,
  state: RowState | 'all',
): MasterGroup[] {
  const search = query.trim().toLocaleLowerCase()
  const groups = new Map<string, { key: string; title: string; path?: string; rows: MasterRow[] }>()
  for (const row of rows) {
    if (state !== 'all' && row.state !== state) continue
    if (search && !`${row.title}\n${row.cwd ?? ''}`.toLocaleLowerCase().includes(search)) continue
    const workspace = workspaces.find(item => item.sessionIds.some(id => id === row.id))
    const key = workspace?.workspaceId ?? ''
    let group = groups.get(key)
    if (group === undefined) {
      group = { key, title: workspace?.title ?? '', ...(workspace === undefined ? {} : { path: workspace.path }), rows: [] }
      groups.set(key, group)
    }
    group.rows.push(row)
  }
  for (const group of groups.values()) group.rows.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  return [...groups.values()].sort((a, b) => a.key === '' ? 1 : b.key === '' ? -1 : a.title.localeCompare(b.title))
}
