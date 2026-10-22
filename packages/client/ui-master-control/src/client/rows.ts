import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'

export type RowState = 'attention' | 'failed' | 'running' | 'idle'

export interface MasterRow {
  readonly id: string
  readonly title: string
  readonly cwd: string | undefined
  readonly state: RowState
  readonly updatedAt: number
  readonly child: boolean
}

const RANK: Record<RowState, number> = { attention: 0, failed: 1, running: 2, idle: 3 }

export function masterRows(list: SessionListState, status: SessionStatusSnapshot): MasterRow[] {
  const rows: MasterRow[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined || summary.blank || id.startsWith('master-control-home-')) continue
    const s = status.get(id)
    const running = s?.running ?? summary.running
    const state: RowState = s?.pendingInteraction !== undefined
      ? 'attention'
      : s?.failureUnread === true ? 'failed' : running ? 'running' : 'idle'
    rows.push({
      id,
      title: summary.displayTitle,
      cwd: summary.cwd,
      state,
      updatedAt: summary.updatedAt,
      child: summary.parentId !== undefined,
    })
  }
  return rows.sort((a, b) => RANK[a.state] - RANK[b.state] || b.updatedAt - a.updatedAt)
}

export function groupMasterRows(rows: readonly MasterRow[], workspaces: readonly WorkspaceView[], query: string, state: RowState | 'all') {
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
