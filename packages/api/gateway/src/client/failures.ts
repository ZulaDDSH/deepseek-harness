/** Folded RemoteResult failure branches built by the Client Remote face. */

import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/**
 * The namespace retired before or during the call, so no request outcome exists.
 * @param endpoint - `<namespace>/<method>` that was called.
 * @returns the failed result.
 */
export function withdrawn(endpoint: string): Extract<RemoteResult<never>, { readonly ok: false }> {
  return internalFailure(`client api: Remote method ${endpoint} is no longer mounted`)
}

/**
 * The error branch a carrier throw (offline, transport fault) folds into: `gateway/internal` naming the endpoint and
 * the thrown message. Exported so a stand-in for this face folds identically.
 * @param endpoint - `<namespace>/<method>` that was called.
 * @param error - what the carrier threw.
 * @returns the failed result.
 */
export function carrierFailure(endpoint: string, error: unknown): Extract<RemoteResult<never>, { readonly ok: false }> {
  return internalFailure(`client api: ${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`)
}

/**
 * The error branch a unary call folds into when it outlives the Client deadline: `gateway/internal` naming the endpoint.
 * @param endpoint - `<namespace>/<method>` that was called.
 * @param ms - deadline that elapsed.
 * @returns the failed result.
 */
export function deadlineFailure(endpoint: string, ms: number): Extract<RemoteResult<never>, { readonly ok: false }> {
  return internalFailure(`client api: ${endpoint} did not answer within ${String(ms)}ms`)
}

/**
 * The error branch a call aborted by its caller folds into: `gateway/cancelled` with the carrier's throw as `cause`.
 * @param endpoint - `<namespace>/<method>` that was called.
 * @param cause - what the carrier threw when the signal aborted.
 * @returns the failed result.
 */
export function cancelledFailure(endpoint: string, cause: unknown): Extract<RemoteResult<never>, { readonly ok: false }> {
  return {
    ok: false,
    error: new RemoteError('gateway/cancelled', `client api: Remote invocation "${endpoint}" was aborted`, {}, { cause }),
  }
}

function internalFailure(message: string): Extract<RemoteResult<never>, { readonly ok: false }> {
  return { ok: false, error: new RemoteError('gateway/internal', message, {}) }
}

/**
 * Whether a caught value is a Remote failure this face delivered or threw.
 * The one consumer-facing discrimination point: marked instances carry their
 * Host code; anything else is a local fault the caller should let crash.
 * @param error - a caught value.
 * @returns true when the value narrows to RemoteFailure.
 */
export function isRemoteFailure(error: unknown): error is RemoteFailure {
  return remoteErrorOf(error) !== undefined
}

/**
 * Rebuild the wire failure as a local RemoteError instance so the error branch
 * carries a real Error and `throw result.error` keeps throw semantics. The code
 * is passed through verbatim without runtime validation: a code outside this
 * Client's merged map still surfaces as-is, so a newer Host stays readable.
 * @param error - the wire failure: code, message and details as the Host sent them.
 * @returns the failure as a local RemoteError instance.
 */
export function rebuiltFailure(error: { code: string; message: string; details: object }): RemoteFailure {
  return new RemoteError(error.code as never, error.message, error.details as never)
}
