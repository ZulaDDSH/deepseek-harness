/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * Every seam refusal that is not a stale write: an unregistered or malformed
     * namespace, a read-only provider, schema validation, storage.
     */
    'settings/rejected': { readonly ns: string }
    /**
     * The stored revision moved after the caller read it. Its own outcome rather
     * than an invalid request: the caller must re-read and re-apply.
     */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /**
     * The provider refused a valid credential write, for example because a
     * read-only source shadows the reference. The details name only the
     * reference, never the value.
     */
    'credential/rejected': { readonly ref: string }
    'authorization/not-found': { readonly key?: string }
    'authorization/failed': { readonly key: string; readonly reason?: string }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}


/** Browser-safe summary of one registered authorization flow. */
export interface AuthorizationEntryView {
  readonly key: string
  readonly label: string
  readonly methods: readonly { readonly id: string; readonly label: string }[]
  readonly inFlight: boolean
  readonly configured: boolean
}

/** First stream item naming the capability for one authorization attempt. */
export interface AuthorizationStart {
  readonly type: 'start'
  readonly attempt: string
  readonly key: string
}

/** Browser-safe progress or prompt emitted by one authorization attempt. */
export interface AuthorizationNotice {
  readonly type: 'notice'
  readonly attempt: string
  readonly message: string
  readonly url?: string
  readonly code?: string
  readonly prompt?: string
  readonly kind?: 'text' | 'secret' | 'select'
  readonly placeholder?: string
  readonly options?: readonly { readonly id: string; readonly label: string }[]
}

/** Terminal stream item for a completed or cancelled authorization attempt. */
export interface AuthorizationEnd {
  readonly type: 'end'
  readonly status: 'authorized' | 'cancelled'
}
