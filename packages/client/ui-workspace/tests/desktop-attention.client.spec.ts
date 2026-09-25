import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DesktopAttentionSource } from '../src/client/desktop-attention.ts'

const sid = (value: string): SessionId => value as SessionId
const id = sid('s1')

function list(): SessionListState {
  return {
    ids: [id],
    byId: {
      [id]: {
        id, displayTitle: 'Background task', running: false, retainedBy: {}, blank: false, updatedAt: 1,
      },
    },
    phase: 'ready',
    projectionsBySession: {},
  }
}

function status(overrides: Record<string, unknown> = {}): SessionStatusSnapshot {
  // The overrides deliberately carry partial or foreign status facts, so the
  // literal is assembled before the map is declared as the snapshot type.
  const entry = {
    running: false,
    pendingInteraction: undefined,
    completionUnread: false,
    ...overrides,
  }
  return new Map([[id, entry]])
}

const sources: DesktopAttentionSource[] = []
afterEach(() => {
  for (const source of sources.splice(0)) source.dispose()
})

describe('DesktopAttentionSource', () => {
  it('does not notify for the initial status baseline or a stable refresh', () => {
    const statuses = createSnapshotStore(status({ completionUnread: true }))
    const sessions = createSnapshotStore(list())
    const notify = vi.fn(async () => {})
    const source = new DesktopAttentionSource(statuses, sessions, { notify, subscribe: () => () => {} }, vi.fn())
    sources.push(source)
    statuses.set(status({ completionUnread: true }))
    expect(notify).not.toHaveBeenCalled()
  })

  it.each([
    ['approval', { pendingInteraction: { key: 'a1', kind: 'approval', sessionId: id } }],
    ['plan-review', { pendingInteraction: { key: 'p1', kind: 'plan-review', sessionId: id } }],
    ['question', { pendingInteraction: { key: 'q1', kind: 'question', sessionId: id } }],
    ['completed', { completionUnread: true }],
    ['failed', { failureUnread: true }],
  ] as const)('notifies once for a new %s transition', (kind, next) => {
    const statuses = createSnapshotStore<SessionStatusSnapshot>(status())
    const sessions = createSnapshotStore(list())
    const notify = vi.fn(async () => {})
    const source = new DesktopAttentionSource(statuses, sessions, { notify, subscribe: () => () => {} }, vi.fn())
    sources.push(source)

    statuses.set(status(next))
    statuses.set(status(next))

    expect(notify).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith({ sessionId: id, title: 'Background task', kind })
  })

  it('prioritizes failure over another simultaneous attention transition', () => {
    const statuses = createSnapshotStore<SessionStatusSnapshot>(status())
    const sessions = createSnapshotStore(list())
    const notify = vi.fn(async () => {})
    const source = new DesktopAttentionSource(statuses, sessions, { notify, subscribe: () => () => {} }, vi.fn())
    sources.push(source)

    statuses.set(status({
      failureUnread: true,
      pendingInteraction: { key: 'q1', kind: 'question', sessionId: id },
      completionUnread: true,
    }))

    expect(notify).toHaveBeenCalledExactlyOnceWith({ sessionId: id, title: 'Background task', kind: 'failed' })
  })

  it('opens only a still-known Session when native attention is activated', () => {
    const statuses = createSnapshotStore<SessionStatusSnapshot>(status())
    const sessions = createSnapshotStore(list())
    let activate: ((sessionId: SessionId) => void) | undefined
    const open = vi.fn()
    const source = new DesktopAttentionSource(statuses, sessions, {
      notify: vi.fn(async () => {}),
      subscribe(listener) { activate = listener; return () => { activate = undefined } },
    }, open)
    sources.push(source)

    activate?.(id)
    expect(open).toHaveBeenCalledExactlyOnceWith(id)
    sessions.set({ ...list(), ids: [], byId: {} })
    activate?.(id)
    expect(open).toHaveBeenCalledOnce()
  })
})
