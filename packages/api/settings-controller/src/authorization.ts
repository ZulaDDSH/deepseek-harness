/**
 * Host owner of the `authorization` Remote namespace: the `ctx.authorization`
 * seam as a browser configuration page runs it.
 *
 * An attempt is one conversation with the human, and the wire has no reverse
 * channel inside a call — a Remote method receives JSON arguments and returns a
 * value, never a callback. So the conversation is split across the two
 * directions that do exist: the running attempt publishes its notices as
 * forwarded Host events, and the human's answers arrive as ordinary Remote
 * calls. `begin` therefore stays pending for as long as the human takes, which
 * is why it takes the caller's lifetime as its cancellation channel.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/authorization.ts
 */

import { Context } from '@deepseek-ai/cordis'
import type { AuthorizationService } from '@deepseek-ai/dsh-authorization'
import type {
  AuthorizationInteraction, AuthorizationNoticeEvent, AuthorizationStatus,
} from '@deepseek-ai/dsh-authorization'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { AuthorizationEntryView } from './types.ts'

/** The forwarded event carrying one attempt's notices to the surface that started it. */
export const AUTHORIZATION_NOTICE_EVENT = 'authorization/notice'

const keySchema = z.string().min(1)
const beginRequestSchema = z.object({
  key: keySchema,
  method: z.string().min(1).optional(),
})
const answerRequestSchema = z.object({
  attempt: z.string().min(1),
  prompt: z.string().min(1),
  value: z.string(),
})

/** One question awaiting an answer, with the resolver the answer call settles. */
interface PendingPrompt {
  readonly attempt: string
  readonly settle: (value: string) => void
  readonly fail: (error: Error) => void
}

/** One attempt in flight, owning everything the model-facing calls address. */
interface Attempt {
  readonly attempt: string
  /** The record being authorized, branded so notices carry the seam's own key type. */
  readonly key: CredentialKey
  readonly controller: AbortController
  readonly prompts: Map<string, PendingPrompt>
  /** Mints the next question id; unique within the attempt. */
  sequence: number
}

/** A JSON error body for a failed attempt, kept off the wire's error channel. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `authorization` Remote namespace. */
    authorizationController: AuthorizationController
  }
}

/**
 * Host service backing the generated `ctx.remote.authorization` namespace.
 *
 * The registry itself lives on `ctx.authorization`, which an LLM adapter fills
 * with the flows it can run; this controller adds the wire obligations — key
 * validation, attempt addressing, prompt correlation, and refusal mapping — and
 * never knows which provider a flow signs into.
 */
export class AuthorizationController extends TypertRemoteService {
  private readonly attempts = new Map<string, Attempt>()
  private sequence = 0

  /** @param ctx - Host context where an authorization registry may be mounted. */
  constructor(ctx: Context) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
  }

  /**
   * Every flow a configuration surface can offer, joined with whether a
   * credential is already stored for it. Credential state is read per key so
   * the page can label a signed-in provider without a second round trip.
   * @returns one entry per registered flow, in registration order.
   */
  @Remote
  async list(): Promise<AuthorizationEntryView[]> {
    const authorization = this.service()
    const entries = authorization.list()
    return Promise.all(entries.map(async entry => ({
      key: entry.key,
      label: entry.label,
      methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
      inFlight: entry.inFlight,
      configured: (await this.ctx.get('credentials')?.describeRecord(entry.key))?.configured ?? false,
    })))
  }

  /**
   * Start one attempt and stay pending until it settles. Notices and questions
   * reach the surface as forwarded events addressed to the returned attempt id;
   * the human's answers come back through `answer`.
   *
   * The returned promise resolves when the flow commits its credential or the
   * human withdraws, and rejects when the flow fails. A failure is reported as
   * a rejection rather than a value so a surface cannot mistake a broken login
   * for a declined one.
   * @param key - the credential record to authorize; a flow must be registered for it.
   * @param method - which of the flow's methods to run; omitted takes the first.
   * @param signal - caller lifetime; aborting withdraws the attempt.
   * @returns how the attempt ended.
   * @throws RemoteError when the request is invalid, no registry or flow exists, or the flow fails.
   */
  @Remote
  async begin(key: string, method: string | undefined, signal: AbortSignal): Promise<{ status: AuthorizationStatus }> {
    const request = parseRequest('authorization.begin', beginRequestSchema, {
      key,
      ...method === undefined ? {} : { method },
    })
    const authorization = this.service()
    let recordKey
    try {
      recordKey = parseCredentialKey(request.key)
    } catch (error: unknown) {
      throw new RemoteError(
        'gateway/bad-request',
        `"${request.key}" is not a credential record address: ${messageOf(error)}`,
        {},
        { cause: error },
      )
    }
    if (authorization.describe(recordKey) === undefined) {
      throw new RemoteError(
        'authorization/not-found',
        `no authorization flow is registered for "${request.key}"; the adapter that owns it is not mounted`,
        { key: request.key },
      )
    }
    const attempt: Attempt = {
      attempt: this.mintAttemptId(),
      key: recordKey,
      controller: new AbortController(),
      prompts: new Map(),
      sequence: 0,
    }
    this.attempts.set(attempt.attempt, attempt)
    const withdraw = (): void => { attempt.controller.abort(signal.reason) }
    signal.addEventListener('abort', withdraw, { once: true })
    if (signal.aborted) withdraw()
    try {
      const outcome = await authorization.begin({
        key: recordKey,
        ...request.method === undefined ? {} : { method: request.method },
        signal: attempt.controller.signal,
        interaction: this.interaction(attempt),
      })
      return { status: outcome.status }
    } catch (error: unknown) {
      throw new RemoteError(
        'authorization/failed',
        messageOf(error),
        { key: request.key },
        { cause: error },
      )
    } finally {
      signal.removeEventListener('abort', withdraw)
      this.settlePrompt(attempt, new Error('the authorization attempt ended'))
      this.attempts.delete(attempt.attempt)
    }
  }

  /**
   * Answer the question a running attempt asked. The value is the typed text,
   * or the chosen option's id for a `select` question.
   * @param attempt - the attempt id returned by `begin`.
   * @param prompt - the question id carried by the question event.
   * @param value - the human's answer.
   * @throws RemoteError when the attempt or question is unknown, or was already answered.
   */
  @Remote
  answer(attempt: string, prompt: string, value: string): void {
    const request = parseRequest('authorization.answer', answerRequestSchema, { attempt, prompt, value })
    const running = this.requireAttempt(request.attempt)
    const pending = running.prompts.get(request.prompt)
    if (pending === undefined) {
      throw new RemoteError(
        'authorization/not-found',
        'that question is not awaiting an answer; it was already answered or the flow moved on',
        { key: running.key },
      )
    }
    running.prompts.delete(request.prompt)
    pending.settle(request.value)
  }

  /**
   * Withdraw a running attempt. The `begin` call it belongs to settles as
   * `cancelled` rather than failing, because a withdrawal is an outcome.
   * @param attempt - the attempt id returned by `begin`.
   * @throws RemoteError when no attempt has that id.
   */
  @Remote
  cancel(attempt: string): void {
    const request = parseRequest('authorization.cancel', z.object({ attempt: z.string().min(1) }), { attempt })
    this.requireAttempt(request.attempt).controller.abort()
  }

  /**
   * The interaction handed to one flow. Notices are published as forwarded
   * events; a question parks until `answer` or `cancel` settles it, which is
   * what keeps the flow running while the human types.
   */
  private interaction(attempt: Attempt): AuthorizationInteraction {
    return {
      notify: (notice) => {
        this.emit({
          attempt: attempt.attempt,
          key: attempt.key,
          message: notice.message,
          ...notice.url === undefined ? {} : { url: notice.url },
          ...notice.code === undefined ? {} : { code: notice.code },
        })
      },
      prompt: (prompt) => {
        const id = String(attempt.sequence++)
        return new Promise<string>((resolve, reject) => {
          attempt.prompts.set(id, { attempt: attempt.attempt, settle: resolve, fail: reject })
          // `select` carries options and no placeholder; the typed kinds carry
          // a placeholder and no options. Narrowing on the discriminant keeps
          // each variant's own fields on the wire.
          this.emit({
            attempt: attempt.attempt,
            key: attempt.key,
            prompt: id,
            kind: prompt.kind,
            message: prompt.message,
            ...prompt.kind === 'select'
              ? { options: prompt.options.map(option => ({ id: option.id, label: option.label })) }
              : { ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder } },
          })
          // A flow racing a browser callback against a typed code retires the
          // losing question through its own signal; that is not the human
          // declining, so it rejects with a plain error.
          prompt.signal?.addEventListener('abort', () => {
            if (attempt.prompts.delete(id)) reject(new Error('the question was withdrawn'))
          }, { once: true })
        })
      },
    }
  }

  /** Settle every question an ending attempt still had parked. */
  private settlePrompt(attempt: Attempt, error: Error): void {
    for (const pending of attempt.prompts.values()) pending.fail(error)
    attempt.prompts.clear()
  }

  /** The live attempt an id names, or the refusal that says it is gone. */
  private requireAttempt(attempt: string): Attempt {
    const running = this.attempts.get(attempt)
    if (running === undefined) {
      throw new RemoteError(
        'authorization/not-found',
        'that authorization attempt is no longer running; it finished, failed, or the page was reloaded',
        {},
      )
    }
    return running
  }

  private mintAttemptId(): string {
    this.sequence += 1
    return `auth-${String(this.sequence)}`
  }

  /**
   * Publish one notice to every connected surface. Fire-and-forget like the
   * notice it carries: a page that is gone must not stall the flow.
   */
  private emit(payload: AuthorizationNoticeEvent): void {
    this.ctx.emit('authorization/notice', payload)
  }
  /** Resolve the optional registry or report how to supply it. */
  private service(): AuthorizationService {
    const authorization = this.ctx.get('authorization')
    if (authorization === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'authorization service is absent: this deployment does not mount @deepseek-ai/dsh-authorization in its composition',
        {},
      )
    }
    return authorization
  }
}

/** Parse the domain constraints that are more specific than generated TypeScript codecs. */
function parseRequest<T>(method: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new RemoteError('gateway/bad-request', `invalid payload for ${method}`, { issues: parsed.error.issues })
  }
  return parsed.data
}

export default AuthorizationController
