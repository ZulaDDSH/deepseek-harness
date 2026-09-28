/** Desktop attention bridge over the unified Session status projection. */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Semantic native-notification category derived from Session UI status. */
export type DesktopAttentionKind = 'approval' | 'plan-review' | 'question' | 'completed' | 'failed'

/** Renderer-to-carrier payload for one Session attention transition. */
export interface DesktopAttentionRequest {
  readonly sessionId: SessionId
  readonly title: string
  readonly kind: DesktopAttentionKind
}

/** Optional isolated Desktop carrier used by the root workspace plugin. */
export interface DesktopAttentionBridge {
  notify(request: DesktopAttentionRequest): Promise<void>
  subscribe(listener: (sessionId: SessionId) => void): () => void
}

function transitionKind(
  previous: SessionStatus | undefined,
  next: SessionStatus,
): DesktopAttentionKind | undefined {
  if (next.failureUnread === true && previous?.failureUnread !== true) return 'failed'
  const pending = next.pendingInteraction
  if (pending !== undefined && pending.key !== previous?.pendingInteraction?.key) {
    if (pending.kind === 'approval' || pending.kind === 'plan-review' || pending.kind === 'question') {
      return pending.kind
    }
  }
  if (next.completionUnread && previous?.completionUnread !== true) return 'completed'
  return undefined
}

/** Converts meaningful background Session transitions into optional native Desktop attention. */
export class DesktopAttentionSource {
  private previous: SessionStatusSnapshot
  private live = true
  private readonly disposeStatus: () => void
  private readonly disposeActivation: () => void

  /**
   * @param statuses - unified Session UI status source.
   * @param sessions - Session catalog used for display titles and existence checks.
   * @param bridge - isolated native carrier.
   * @param openSession - existing workspace navigation action.
   */
  constructor(
    private readonly statuses: HostObservable<SessionStatusSnapshot>,
    private readonly sessions: HostObservable<SessionListState>,
    private readonly bridge: DesktopAttentionBridge,
    private readonly openSession: (sessionId: SessionId) => void,
  ) {
    this.previous = statuses.getSnapshot()
    this.disposeStatus = statuses.subscribe(() => { this.sync() })
    this.disposeActivation = bridge.subscribe((sessionId) => {
      if (!this.live || this.sessions.getSnapshot().byId[sessionId] === undefined) return
      this.openSession(sessionId)
    })
  }

  private sync(): void {
    if (!this.live) return
    const next = this.statuses.getSnapshot()
    const list = this.sessions.getSnapshot()
    for (const [sessionId, status] of next) {
      const kind = transitionKind(this.previous.get(sessionId), status)
      if (kind === undefined) continue
      const row = list.byId[sessionId]
      if (row === undefined) continue
      void this.bridge.notify({ sessionId, title: row.displayTitle, kind }).catch(() => {})
    }
    this.previous = next
  }

  /** Stop observing status and native activation events. */
  dispose(): void {
    if (!this.live) return
    this.live = false
    this.disposeStatus()
    this.disposeActivation()
  }
}
