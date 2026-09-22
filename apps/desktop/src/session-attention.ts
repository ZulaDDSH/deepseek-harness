/** Native notification ownership for Session attention transitions. */
import { Notification, type BrowserWindow } from 'electron'
import type { DesktopAttentionKind, DesktopAttentionRequest } from './ipc.ts'
import type { DesktopLocale } from './locale.ts'

function bodyFor(kind: DesktopAttentionKind, locale: DesktopLocale): string {
  switch (kind) {
    case 'approval': return locale.messages.sessionAttentionApproval
    case 'plan-review': return locale.messages.sessionAttentionPlanReview
    case 'question': return locale.messages.sessionAttentionQuestion
    case 'completed': return locale.messages.sessionAttentionCompleted
    case 'failed': return locale.messages.sessionAttentionFailed
  }
}

/** Owns at most one live OS notification per Session. */
export class DesktopSessionAttention {
  private readonly notifications = new Map<string, Notification>()

  /**
   * @param locale - Desktop-owned localized notification copy.
   * @param window - current primary window resolver.
   * @param activate - callback that routes notification activation to a Session.
   */
  constructor(
    private readonly locale: DesktopLocale,
    private readonly window: () => BrowserWindow | undefined,
    private readonly activate: (sessionId: string) => void,
  ) {}

  /**
   * Replace the live notification for one Session with its newest attention state.
   * @param request - validated Session attention request.
   */
  notify(request: DesktopAttentionRequest): void {
    const parent = this.window()
    if (parent === undefined || parent.isDestroyed() || !Notification.isSupported()) return
    this.clear(request.sessionId)
    const notification = new Notification({
      title: request.title === '' ? this.locale.messages.application : request.title,
      body: bodyFor(request.kind, this.locale),
      silent: true,
    })
    this.notifications.set(request.sessionId, notification)
    notification.once('click', () => {
      if (this.notifications.get(request.sessionId) !== notification) return
      this.clear(request.sessionId)
      const target = this.window()
      if (target === undefined || target.isDestroyed()) return
      if (target.isMinimized()) target.restore()
      target.show()
      target.focus()
      this.activate(request.sessionId)
    })
    notification.once('failed', () => {
      if (this.notifications.get(request.sessionId) === notification) {
        this.notifications.delete(request.sessionId)
      }
      notification.removeAllListeners()
    })
    notification.show()
  }

  private clear(sessionId: string): void {
    const notification = this.notifications.get(sessionId)
    if (notification === undefined) return
    this.notifications.delete(sessionId)
    notification.removeAllListeners()
    try { notification.close() }
    catch (error) { console.warn('desktop attention: could not close notification', error) }
  }

  /** Close every owned notification and detach its handlers. */
  dispose(): void {
    for (const sessionId of [...this.notifications.keys()]) this.clear(sessionId)
  }
}
