import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'

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
    if (summary === undefined || summary.blank) continue
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
