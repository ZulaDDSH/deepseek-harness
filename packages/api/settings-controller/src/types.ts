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
    /**
     * No flow claims that credential record, so nothing can obtain it. The
     * common cause is a composition that mounts no adapter owning the key.
     */
    'authorization/not-found': { readonly key?: string }
    /**
     * The flow itself failed — a refused grant, a network error, a provider
     * rejection. Distinct from a cancellation, which is an outcome.
     */
    'authorization/failed': { readonly key: string; readonly reason?: string }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** Result of opening or revealing one locally authored Agent preset directory. */
export type AgentPresetDirectoryOpenValue =
  | { readonly opened: true }
  | { readonly opened: false; readonly path: string }

/** One registered authorization flow as the settings page lists it. */
export interface AuthorizationEntryView {
  /** The credential record this flow writes. */
  readonly key: string
  /** User-facing name of what is being authorized. */
  readonly label: string
  /** The methods this flow offers, most preferred first. */
  readonly methods: readonly { readonly id: string; readonly label: string }[]
  /** Whether an attempt for this key is running right now. */
  readonly inFlight: boolean
  /** Whether a credential is already stored for this key. */
  readonly configured: boolean
}

/**
 * The first item of one attempt's stream. It names the capability the caller
 * answers and withdraws through; the Host mints it per attempt and delivers it
 * only to the client that opened the stream, so a second client can neither
 * observe nor act on this attempt.
 */
export interface AuthorizationStart {
  /** Always `start`, so the caller distinguishes this from a notice. */
  readonly type: 'start'
  /** The unguessable capability addressing this attempt. */
  readonly attempt: string
  /** The credential record being authorized. */
  readonly key: string
}

/**
 * One report from a running attempt, delivered on the opener's stream. The
 * message may carry an authorization URL, a device code, or a question, so it
 * is never broadcast: it reaches only the client that started the attempt.
 */
export interface AuthorizationNotice {
  /** Always `notice`, so the caller distinguishes this from the start item. */
  readonly type: 'notice'
  /** The capability addressing the attempt this notice belongs to. */
  readonly attempt: string
  /** What is happening, or what the human must do next. */
  readonly message: string
  /** A page the human must open to continue. */
  readonly url?: string
  /** A short code the human must enter on that page. */
  readonly code?: string
  /** Identifies the question this notice asks, when the flow needs an answer. */
  readonly prompt?: string
  /** How that question should be presented. */
  readonly kind?: 'text' | 'secret' | 'select'
  /** Placeholder for a typed answer, when the flow named one. */
  readonly placeholder?: string
  /** Choices for a `select` question. */
  readonly options?: readonly { readonly id: string; readonly label: string }[]
}

/**
 * The last item of one attempt's stream, naming how the attempt ended. It is
 * delivered rather than thrown because both `authorized` and `cancelled` are
 * outcomes: only a genuine flow failure rejects the stream.
 */
export interface AuthorizationEnd {
  /** Always `end`, so the caller distinguishes this from a notice. */
  readonly type: 'end'
  /** How the attempt ended. */
  readonly status: 'authorized' | 'cancelled'
}
