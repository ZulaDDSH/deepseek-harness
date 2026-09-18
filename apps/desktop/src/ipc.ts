/** Typed preload operations exposed only by the Electron shell. */

import type { IpcMainInvokeEvent } from 'electron'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  boot: 'dsh-desktop:boot',
  bootFailed: 'dsh-desktop:boot-failed',
  directoryPick: 'dsh-desktop:directory-pick',
  updatesStatus: 'dsh-desktop:updates-status',
  updatesOpen: 'dsh-desktop:updates-open',
  updatesPresentation: 'dsh-desktop:updates-presentation',
  attentionNotify: 'dsh-desktop:attention-notify',
  attentionActivate: 'dsh-desktop:attention-activate',
  nativeThemeSet: 'dsh-desktop:native-theme-set',
  windowsAppearance: 'dsh-desktop:windows-appearance',
  windowsMenu: 'dsh-desktop:windows-menu',
} as const

/** Desktop release update state rendered by desktop-owned UI. */
export type DesktopUpdatePreparationFailureKind = 'stop-failed' | 'tasks-changed' | 'tasks-unavailable'

export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
  /** Main-owned diagnostics without subprocess output or credentials; hidden until expanded. */
  readonly technicalDetails?: string
  readonly percent?: number
  readonly failedOperation?: 'check' | 'download' | 'install'
  /** Main-owned preparation cause; UI wording is selected by the active locale. */
  readonly preparationFailure?: DesktopUpdatePreparationFailureKind
}

/** Classified failure copy selected by the Web locale without exposing raw updater diagnostics. */
export type DesktopUpdateFailureKind =
  | 'check'
  | 'check-network'
  | 'download'
  | 'download-network'
  | 'install'
  | 'install-network'
  | 'stop-failed'
  | 'tasks-changed'
  | 'tasks-unavailable'

/** Semantic status content; actions open main-process confirmation dialogs only. */
export interface DesktopUpdatePresentation {
  readonly phase: DesktopUpdateState['phase']
  readonly version?: string
  readonly percent?: number
  readonly failure?: DesktopUpdateFailureKind
}

/** Native-notification category produced by the renderer's Session attention projection. */
export type DesktopAttentionKind = 'approval' | 'plan-review' | 'question' | 'completed' | 'failed'

/** Bounded renderer request for one native Session notification. */
export interface DesktopAttentionRequest {
  readonly sessionId: string
  readonly title: string
  readonly kind: DesktopAttentionKind
}

/**
 * Validate one product-renderer attention request before native presentation.
 * @param value - untrusted IPC payload from the product renderer.
 * @returns the bounded semantic attention request.
 * @throws when identity, title, or kind is invalid.
 */
export function parseDesktopAttentionRequest(value: unknown): DesktopAttentionRequest {
  if (typeof value !== 'object' || value === null) throw new Error('dsh desktop: invalid attention request')
  const request = value as Record<string, unknown>
  const kinds: readonly DesktopAttentionKind[] = ['approval', 'plan-review', 'question', 'completed', 'failed']
  if (typeof request.sessionId !== 'string' || request.sessionId.length === 0 || request.sessionId.length > 512
    || typeof request.title !== 'string' || request.title.length > 256
    || typeof request.kind !== 'string' || !kinds.includes(request.kind as DesktopAttentionKind)) {
    throw new Error('dsh desktop: invalid attention request')
  }
  return { sessionId: request.sessionId, title: request.title, kind: request.kind as DesktopAttentionKind }
}

/** Product documents cannot supply update versions, package URLs, or installation authorization. */
export interface DshDesktopProductApi {
  readonly protocolVersion: 1
  readonly updates: {
    status(): Promise<DesktopUpdatePresentation>
    open(): Promise<void>
    subscribe(listener: (state: DesktopUpdatePresentation) => void): () => void
  }
  readonly attention: {
    notify(request: DesktopAttentionRequest): Promise<void>
    subscribe(listener: (sessionId: string) => void): () => void
  }
}

/** Scheme of Desktop-owned application documents. */
export const SCHEME = 'dsh-app'

/**
 * Reject IPC outside the allowed Desktop document origins.
 * @param event - IPC caller whose frame URL supplies the origin.
 * @param hostnames - Desktop document hosts allowed for this operation.
 */
export function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('dsh desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('dsh desktop: rejected IPC from an unowned renderer')
  }
}
