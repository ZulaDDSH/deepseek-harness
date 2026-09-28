/**
 * The Host authorization calls the Models cards perform, as callbacks built in
 * the plugin body. Cards receive these instead of a context: the outcomes name
 * what a card renders — a list of flows, a notice to show, a refusal message —
 * so the Remote namespace and its failure codes stay in the apply world.
 *
 * An attempt is one stream plus the answers the card sends back. The stream
 * delivers only this card's attempt: its first item names the capability the
 * card addresses, and every later item is a notice the flow produced. Nothing
 * here is broadcast, so a notice carrying an authorization URL or a code
 * reaches the surface that started the attempt and no other.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  AuthorizationEntryView, AuthorizationNotice,
} from '@deepseek-ai/dsh-api-settings-controller/types'

/** What one attempt did. */
export type AuthorizationOutcome =
  /** The flow committed a credential. */
  | { readonly kind: 'authorized' }
  /** The human withdrew, or the flow was cancelled. */
  | { readonly kind: 'cancelled' }
  /** The flow failed, with the Host's own diagnostic. */
  | { readonly kind: 'failed'; readonly message: string }

/** What one answer call did. */
export type AnswerOutcome =
  /** The Host accepted the answer and the flow continued. */
  | { readonly kind: 'accepted' }
  /** The Host refused it, with its own diagnostic; the question is still open. */
  | { readonly kind: 'refused'; readonly message: string }

/** One item the attempt stream delivers. */
export type AttemptStreamItem =
  | { readonly type: 'start'; readonly attempt: string; readonly key: string }
  | AuthorizationNotice
  | { readonly type: 'end'; readonly status: 'authorized' | 'cancelled' }

/** The authorization operations a Models card invokes. */
export interface AuthorizationOperations {
  /**
   * List every flow this deployment can sign into.
   * @returns one entry per registered flow; empty when the surface cannot read them.
   */
  list(): Promise<readonly AuthorizationEntryView[]>
  /**
   * Run one attempt, delivering its notices through `onItem` as they arrive.
   * @param key - the credential record to authorize.
   * @param method - which of the flow's methods to run.
   * @param onItem - called for the start item and every notice of this attempt.
   * @param signal - aborts the attempt when the card unmounts or the human cancels.
   * @returns how the attempt ended.
   */
  begin(
    key: string,
    method: string | undefined,
    onItem: (item: AttemptStreamItem) => void,
    signal: AbortSignal,
  ): Promise<AuthorizationOutcome>
  /**
   * Answer a question the running attempt asked.
   * @param attempt - the capability the attempt's start item named.
   * @param prompt - the question id carried by the question notice.
   * @param value - the typed answer, or a `select` option's id.
   * @returns whether the Host accepted it, or its refusal.
   */
  answer(attempt: string, prompt: string, value: string): Promise<AnswerOutcome>
  /**
   * Withdraw a running attempt, so the Host stops the flow and the stream ends
   * as `cancelled`. Addressed by capability rather than by aborting the
   * stream: the attempt outlives one carrier, and a withdrawn carrier is a
   * breakage the card must not report as a cancellation.
   * @param attempt - the capability the attempt's start item named.
   */
  cancel(attempt: string): Promise<void>
}

/**
 * Bind the page's authorization calls to its optional Remote namespace.
 * @param remote - the namespace resolved by the plugin's optional service lookup.
 * @returns the callbacks the cards are injected with.
 */
export function createAuthorizationOperations(
  remote: NonNullable<ClientContext['remote']['authorization']>,
): AuthorizationOperations {
  return {
    list: async () => {
      const response = await remote.list()
      return response.ok ? response.value : []
    },
    begin: async (key, method, onItem, signal) => {
      // A stream call hands back the iterable itself; a refusal (an unknown
      // flow) rejects the iteration rather than returning a RemoteResult.
      let status: 'authorized' | 'cancelled' = 'cancelled'
      try {
        for await (const item of remote.begin(key, method, signal)) {
          if (item.type === 'end') status = item.status
          onItem(item)
        }
      } catch (error: unknown) {
        return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
      return status === 'authorized' ? { kind: 'authorized' } : { kind: 'cancelled' }
    },
    answer: async (attempt, prompt, value) => {
      const response = await remote.answer(attempt, prompt, value)
      return response.ok ? { kind: 'accepted' } : { kind: 'refused', message: response.error.message }
    },
    cancel: async (attempt) => {
      // A withdrawal for an attempt that already ended is not a failure: the
      // human got what they asked for either way, and the stream reports how
      // the attempt actually settled.
      await remote.cancel(attempt)
    },
  }
}
