import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { groupMasterRows, masterRows } from '../src/client/rows.ts'

function summary(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id, displayTitle: id, running: false, retainedBy: {}, blank: false, updatedAt: 0, ...over,
  } as SessionSummary
}

function list(...rows: SessionSummary[]): SessionListState {
  return {
    ids: rows.map(r => r.id),
    byId: Object.fromEntries(rows.map(r => [r.id, r])),
    phase: 'ready',
    projectionsBySession: {},
  }
}

describe('masterRows', () => {
  it('uses workspace membership, separates identical labels, and sorts within each group by recency', () => {
    const rows = masterRows(list(summary('older', { updatedAt: 1, running: true }), summary('newer', { updatedAt: 5 }), summary('loose')), new Map() as never)
    const groups = groupMasterRows(rows, [
      { workspaceId: 'a', title: 'Project', path: 'D:/a', sessionIds: ['older', 'newer'] },
      { workspaceId: 'b', title: 'Project', path: 'D:/b', sessionIds: [] },
    ] as never, '', 'all')
    expect(groups.map(group => [group.key, group.rows.map(row => row.id)])).toEqual([['a', ['newer', 'older']], ['', ['loose']]])
  })

  it('drops blank sessions and orders attention, failed, running, idle then recency', () => {
    const state = list(
      summary('idle-old', { updatedAt: 1 }),
      summary('idle-new', { updatedAt: 9 }),
      summary('blank', { blank: true }),
      summary('run', { running: true, updatedAt: 5 }),
      summary('fail', { updatedAt: 2 }),
      summary('ask', { updatedAt: 3 }),
    )
    const status: SessionStatusSnapshot = new Map([
      ['fail', { running: false, pendingInteraction: undefined, completionUnread: false, failureUnread: true }],
      ['ask', { running: true, pendingInteraction: { kind: 'x' }, completionUnread: false }],
    ]) as never
    expect(masterRows(state, status).map(r => [r.id, r.state])).toEqual([
      ['ask', 'attention'],
      ['fail', 'failed'],
      ['run', 'running'],
      ['idle-new', 'idle'],
      ['idle-old', 'idle'],
    ])
  })

  it('prefers the UI status running flag over the summary and marks children', () => {
    const state = list(summary('a', { running: true, parentId: 'p' as never }))
    const status: SessionStatusSnapshot = new Map([
      ['a', { running: false, pendingInteraction: undefined, completionUnread: false }],
    ]) as never
    const [row] = masterRows(state, status)
    expect(row).toMatchObject({ state: 'idle', child: true })
  })
})
