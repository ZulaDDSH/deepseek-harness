/**
 * Wire-safe authorization types, free of cordis/service imports so browser type
 * chains can consume them without loading this
 * package's Context augmentation.
 * @module @deepseek-ai/dsh-authorization/types
 */

import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'

/** One way a flow can obtain its credential, named by the flow that offers it. */
export interface AuthorizationMethod {
  /** Flow-owned identifier, echoed back when a caller picks this method. */
  id: string
  /** User-facing label for a picker. */
  label: string
}

/** A running flow's report to whoever is watching it. Never carries a secret. */
export interface AuthorizationNotice {
  /** What is happening, or what the human must do next. */
  message: string
  /** A page the human must open to continue. */
  url?: string
  /** A short code the human must enter on that page. */
  code?: string
}

/** One choice offered by a `select` prompt. */
export interface AuthorizationPromptOption {
  /** Value returned when this option is chosen. */
  id: string
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable surfaces. */
  description?: string
}

/**
 * A question a flow must have answered before it can continue. `secret` differs
 * from `text` only in presentation — a surface masks it and keeps it out of
 * logs — and `select` answers with the chosen option's `id`.
 */
export type AuthorizationPrompt = {
  /**
   * Withdraws this prompt alone, leaving the flow running. A flow that races a
   * typed code against a browser callback aborts the losing prompt here; the
   * whole authorization is cancelled through the request's signal instead.
   */
  signal?: AbortSignal
} & ({
  kind: 'text'
  message: string
  placeholder?: string
} | {
  kind: 'secret'
  message: string
  placeholder?: string
} | {
  kind: 'select'
  message: string
  options: readonly AuthorizationPromptOption[]
})

/** How one authorization attempt ended, as its own caller sees it. */
export type AuthorizationStatus = 'authorized' | 'cancelled'

/**
 * How one attempt ended, as an onlooker sees it. A failure reaches its caller
 * as a thrown error rather than an outcome, so `failed` exists only here — on
 * the event stream, where a watcher that did not start the attempt has no
 * other way to tell a refusal from a breakage.
 */
export type AuthorizationSettlement = AuthorizationStatus | 'failed'

/** The result of one `begin()` attempt. */
export interface AuthorizationOutcome {
  /** `authorized` once the record is committed and observed; `cancelled` when the human or caller withdrew. */
  status: AuthorizationStatus
}

/** A registered flow as a surface sees it: what it authorizes and whether it is busy. */
export interface AuthorizationEntry {
  /** The credential record this flow writes. */
  key: CredentialKey
  /** User-facing name of what is being authorized. */
  label: string
  /** The methods this flow offers, most preferred first. */
  methods: readonly AuthorizationMethod[]
  /** Whether an attempt for this key is running right now. */
  inFlight: boolean
}

/**
 * One authorization attempt as a surface watching the seam sees it.
 *
 * A notice carries an authorization URL, a device code, or a question, so it is
 * never published on a Host-wide channel: the surface that started the attempt
 * receives its own notices directly, and a surface that never saw a question
 * cannot answer one it was not shown.
 */
export interface AuthorizationNoticeEvent {
  /** The credential record being authorized. */
  key: CredentialKey
  /** What is happening, or what the human must do next. */
  message: string
  /** A page the human must open to continue. */
  url?: string
  /** A short code the human must enter on that page. */
  code?: string
  /** Identifies the question this notice asks, when the flow needs an answer. */
  prompt?: string
  /** How that question should be presented. */
  kind?: AuthorizationPrompt['kind']
  /** Placeholder for a typed answer, when the flow named one. */
  placeholder?: string
  /** Choices for a `select` question. */
  options?: readonly AuthorizationPromptOption[]
}

/** One attempt reaching a terminal state, so a surface stops offering to answer it. */
export interface AuthorizationSettledEvent {
  /** The attempt that ended. */
  attempt: string
  /** The credential record it was authorizing. */
  key: CredentialKey
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One authorization attempt has finished and released its key. Fires for
     * every terminal outcome, failures included, so a surface watching a key it
     * did not start (a second browser tab) learns the attempt is over.
     * @param key - the credential record the finished attempt was authorizing.
     * @param settlement - how it ended, including the `failed` case its caller sees as a thrown error.
     * @mode emit
     */
    'authorization/settled'(key: CredentialKey, settlement: AuthorizationSettlement): void
  }
}
