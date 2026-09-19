/**
 * The Host authorization calls the Models cards perform, as callbacks built in
 * the plugin body. Cards receive these instead of a context: the outcomes name
 * what a card renders — a list of flows, a notice to show, a refusal message —
 * so the Remote namespace and its failure codes stay in the apply world.
 *
 * An attempt is one long-running call plus the notices it pushes while it runs.
 * The card starts the call and renders whatever notices arrive for the attempt
 * id it was given; a question is answered by a second call, because the wire
 * has no reply path inside the first.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { AuthorizationEntryView } from '@deepseek-ai/dsh-api-settings-controller/types'
import type { AuthorizationNoticeEvent } from '@deepseek-ai/dsh-authorization/types'

/** What one attempt did. */
export type AuthorizationOutcome =
  /** The flow committed a credential. */
  | { readonly kind: 'authorized' }
  /** The human withdrew, or the flow was cancelled. */
  | { readonly kind: 'cancelled' }
  /** The flow failed, with the Host's own diagnostic. */
  | { readonly kind: 'failed'; readonly message: string }

/** The authorization operations a Models card invokes. */
export interface AuthorizationOperations {
  /**
   * List every flow this deployment can sign into.
   * @returns one entry per registered flow; empty when the surface cannot read them.
   */
  list(): Promise<readonly AuthorizationEntryView[]>
  /**
   * Run one attempt to completion. Notices and questions arrive through
   * {@link AuthorizationOperations.onNotice} while this is pending.
   * @param key - the credential record to authorize.
   * @param method - which of the flow's methods to run.
   * @param signal - aborts the attempt when the card unmounts or the human cancels.
   * @returns how the attempt ended.
   */
  begin(key: string, method: string | undefined, signal: AbortSignal): Promise<AuthorizationOutcome>
  /**
   * Answer a question the running attempt asked.
   * @param attempt - the attempt id from the notice.
   * @param prompt - the question id from the notice.
   * @param value - the typed answer, or a `select` option's id.
   */
  answer(attempt: string, prompt: string, value: string): Promise<void>
  /**
   * Watch one attempt's notices.
   * @param listener - called for every notice the Host forwards.
   * @returns the disposer that stops watching.
   */
  onNotice(listener: (notice: AuthorizationNoticeEvent) => void): () => void
}

/**
 * Bind the page's authorization calls to the plugin's own Remote namespace.
 * @param ctx - the page plugin's context, which declares `remote.authorization`
 *   in its own `inject`.
 * @returns the callbacks the cards are injected with.
 */
export function createAuthorizationOperations(ctx: ClientContext): AuthorizationOperations {
  return {
    list: async () => {
      const response = await ctx.remote.authorization.list()
      return response.ok ? response.value : []
    },
    begin: async (key, method, signal) => {
      const response = await ctx.remote.authorization.begin(key, method, signal)
      if (!response.ok) return { kind: 'failed', message: response.error.message }
      return response.value.status === 'authorized' ? { kind: 'authorized' } : { kind: 'cancelled' }
    },
    answer: async (attempt, prompt, value) => {
      await ctx.remote.authorization.answer(attempt, prompt, value)
    },
    onNotice: listener => ctx.remote.$on('authorization/notice', (notice) => { listener(notice) }),
  }
}
