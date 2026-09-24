/**
 * Host owner of the `authorization` Remote namespace: the `ctx.authorization`
 * seam as a browser configuration page runs it.
 *
 * An attempt is one conversation with the human, and the wire has no reverse
 * channel inside a call — a Remote method receives JSON arguments and returns a
 * value, never a callback. So the conversation is split across the two
 * directions that do exist. `begin` is a stream: it delivers this attempt's
 * notices to the one client that opened it and resolves when the attempt ends.
 * The human's answers arrive as ordinary `answer` calls.
 *
 * A notice can carry an authorization URL, a device code, or a prompt, so it is
 * addressed by an unguessable capability minted per attempt and delivered only
 * on the opener's own carrier. Nothing here is broadcast: a second client
 * receives no notice and cannot answer or cancel an attempt it did not start.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/authorization.ts
 */

import { randomBytes } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { AuthorizationService } from '@deepseek-ai/dsh-authorization'
import type {
  AuthorizationInteraction, AuthorizationStatus,
} from '@deepseek-ai/dsh-authorization'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type {
  AuthorizationEnd, AuthorizationEntryView, AuthorizationNotice, AuthorizationStart,
} from './types.ts'

const keySchema = z.string().min(1)
const beginRequestSchema = z.object({
  key: keySchema,
  method: z.string().min(1).optional(),
})
const capabilitySchema = z.string().min(1)
const answerRequestSchema = z.object({
  attempt: capabilitySchema,
  prompt: z.string().min(1),
  value: z.string(),
})

function parseRequest<T>(method: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new RemoteError('gateway/bad-request', `invalid payload for ${method}`, { issues: parsed.error.issues })
  }
  return parsed.data
}

/** One question awaiting an answer, with the resolver the answer call settles. */
interface PendingPrompt {
  readonly settle: (value: string) => void
  readonly fail: (error: Error) => void
  /** Detaches the withdrawal listener this question registered on its own signal. */
  readonly detach: () => void
}

/** One attempt in flight, owning everything the model-facing calls address. */
interface Attempt {
  /** Unguessable capability addressing this attempt; never derived from the key. */
  readonly capability: string
  /** The record being authorized. */
  readonly key: CredentialKey
  readonly controller: AbortController
  readonly prompts: Map<string, PendingPrompt>
  /** Delivers one notice to the client that opened this attempt. */
  readonly deliver: (notice: AuthorizationNotice) => void
  /** Ends the stream once the attempt settles. */
  readonly finish: (outcome: { status: AuthorizationStatus }) => void
  /** Fails the stream when the attempt cannot produce an outcome. */
  readonly fail: (error: unknown) => void
  /** Mints the next question id; unique within the attempt. */
  sequence: number
}

/** A JSON error body for a failed attempt, kept off the wire's error channel. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The flow failure a caller reads. The stream reports a broken attempt by
 * rejecting, and the rejection crosses the wire as a Remote failure: leaving it
 * as the raw thrown value would arrive as an unclassified `gateway/internal`,
 * hiding the difference between a refused grant and a broken carrier. A
 * `HarnessError` already carries the domain's own reason code, so it is kept;
 * anything else is typed by its constructor name.
 * @param key - the credential record the failed attempt was authorizing.
 * @param error - what the flow threw.
 * @returns the typed failure the caller receives.
 */
function flowFailure(key: CredentialKey, error: unknown): RemoteError<'authorization/failed'> {
  const reason = reasonOf(error)
  return new RemoteError(
    'authorization/failed',
    `authorization flow for "${key}" failed: ${messageOf(error)}`,
    { key, ...reason === undefined ? {} : { reason } },
    { cause: error },
  )
}

/** The failure's own code, or its class name when it carries none. */
function reasonOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code
  if (typeof code === 'string' && code.length > 0) return code
  const name = (error as { name?: unknown } | null | undefined)?.name
  if (typeof name === 'string' && name.length > 0 && name !== 'Error') return name
  return undefined
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
 * validation, capability addressing, prompt correlation, and refusal mapping —
 * and never knows which provider a flow signs into.
 */
export class AuthorizationController extends TypertRemoteService {
  private readonly attempts = new Map<string, Attempt>()

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
   * Run one attempt, delivering its notices to this caller alone.
   *
   * The first item names the attempt capability and every later item is a
   * notice from the flow. The caller answers through `answer` and withdraws
   * through `cancel`, both addressed by that capability. The stream ends when
   * the flow commits its credential, the human withdraws, or the flow fails.
   * @param key - the credential record to authorize; a flow must be registered for it.
   * @param method - which of the flow's methods to run; omitted takes the first.
   * @param signal - caller lifetime; aborting withdraws the attempt.
   * @returns one start item followed by this attempt's notices.
   * @throws RemoteError when the request is invalid or no flow claims the key.
   */
  @Remote({ mode: 'stream' })
  async *begin(
    key: string,
    method: string | undefined,
    signal: AbortSignal,
  ): AsyncIterable<AuthorizationStart | AuthorizationNotice | AuthorizationEnd> {
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

    const queue = new NoticeQueue<AuthorizationStart | AuthorizationNotice | AuthorizationEnd>()
    const capability = mintCapability()
    const attempt: Attempt = {
      capability,
      key: recordKey,
      controller: new AbortController(),
      prompts: new Map(),
      deliver: (notice) => { queue.push(notice) },
      finish: (outcome) => { queue.close({ type: 'end', status: outcome.status }) },
      fail: (error) => { queue.fail(error) },
      sequence: 0,
    }
    this.attempts.set(capability, attempt)
    const withdraw = (): void => { attempt.controller.abort(signal.reason) }
    signal.addEventListener('abort', withdraw, { once: true })
    if (signal.aborted) withdraw()

    const running = authorization.begin({
      key: recordKey,
      ...request.method === undefined ? {} : { method: request.method },
      signal: attempt.controller.signal,
      interaction: this.interaction(attempt),
    }).then(
      (outcome) => { attempt.finish({ status: outcome.status }) },
      (error: unknown) => { attempt.fail(flowFailure(recordKey, error)) },
    )
    try {
      yield { type: 'start', attempt: capability, key: recordKey }
      for await (const item of queue.iterate()) {
        yield item
      }
    } finally {
      signal.removeEventListener('abort', withdraw)
      this.settlePrompt(attempt, new Error('the authorization attempt ended'))
      attempt.controller.abort()
      this.attempts.delete(capability)
      await running
    }
  }

  /**
   * Answer the question a running attempt asked. The value is the typed text,
   * or the chosen option's id for a `select` question.
   * @param attempt - the capability the attempt's start item named.
   * @param prompt - the question id carried by the question notice.
   * @param value - the human's answer.
   * @throws RemoteError when the capability is unknown or the question is not awaiting one.
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
    pending.detach()
    pending.settle(request.value)
  }

  /**
   * Withdraw a running attempt. The attempt's stream ends as `cancelled` rather
   * than failing, because a withdrawal is an outcome.
   * @param attempt - the capability the attempt's start item named.
   * @throws RemoteError when no attempt has that capability.
   */
  @Remote
  cancel(attempt: string): void {
    const request = parseRequest(
      'authorization.cancel', z.object({ attempt: capabilitySchema }), { attempt })
    this.requireAttempt(request.attempt).controller.abort()
  }

  /**
   * The interaction handed to one flow. Every notice goes to the client that
   * opened the attempt; a question parks until `answer` or `cancel` settles it,
   * which is what keeps the flow running while the human types.
   */
  private interaction(attempt: Attempt): AuthorizationInteraction {
    return {
      notify: (notice) => {
        attempt.deliver({
          type: 'notice',
          attempt: attempt.capability,
          message: notice.message,
          ...notice.url === undefined ? {} : { url: notice.url },
          ...notice.code === undefined ? {} : { code: notice.code },
        })
      },
      prompt: (prompt) => {
        const id = String(attempt.sequence++)
        return new Promise<string>((resolve, reject) => {
          const onWithdrawn = (): void => {
            if (attempt.prompts.delete(id)) reject(new Error('the question was withdrawn'))
          }
          const notice: AuthorizationNotice = {
            type: 'notice',
            attempt: attempt.capability,
            prompt: id,
            kind: prompt.kind,
            message: prompt.message,
            ...prompt.kind === 'select'
              ? { options: prompt.options.map(option => ({ id: option.id, label: option.label })) }
              : { ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder } },
          }
          attempt.prompts.set(id, {
            settle: resolve,
            fail: reject,
            detach: () => { prompt.signal?.removeEventListener('abort', onWithdrawn) },
          })
          attempt.deliver(notice)
          if (prompt.signal?.aborted === true) {
            onWithdrawn()
            return
          }
          prompt.signal?.addEventListener('abort', onWithdrawn, { once: true })
        })
      },
    }
  }

  /** Settle every question an ending attempt still had parked. */
  private settlePrompt(attempt: Attempt, error: Error): void {
    for (const pending of attempt.prompts.values()) {
      pending.detach()
      pending.fail(error)
    }
    attempt.prompts.clear()
  }

  /** The live attempt a capability names, or the refusal that says it is gone. */
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

/**
 * Mint one attempt capability. Random rather than sequential so a client
 * cannot address, answer, or cancel another client's attempt by guessing an
 * id, and so nothing about the credential key leaks through the address.
 * @returns the capability to hand the starting caller.
 */
function mintCapability(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Bridges a flow's synchronous notices to the stream generator, preserving
 * order and settling either way once the attempt ends.
 * @template T - the item the consumer receives.
 */
class NoticeQueue<T> {
  private readonly buffered: T[] = []
  private wake: (() => void) | undefined
  private ended = false
  private failure: Error | undefined

  /**
   * Append one item and wake the consumer.
   * @param item - the item to deliver next.
   */
  push(item: T): void {
    if (this.ended) return
    this.buffered.push(item)
    this.wake?.()
  }

  /**
   * End the stream successfully once every buffered item is consumed.
   * @param item - a final item to deliver before the stream ends.
   */
  close(item: T): void {
    if (this.ended) return
    this.buffered.push(item)
    this.ended = true
    this.wake?.()
  }

  /**
   * End the stream with a failure. The thrown value crosses a wire boundary, so
   * it is normalized to an Error here rather than surfacing a bare value.
   * @param error - what the attempt threw.
   */
  fail(error: unknown): void {
    if (this.ended) return
    this.failure = error instanceof Error ? error : new Error(String(error))
    this.ended = true
    this.wake?.()
  }

  /**
   * Consume items as they arrive, ending when the attempt does.
   * @returns the items in delivery order.
   */
  async *iterate(): AsyncGenerator<T> {
    for (;;) {
      while (this.buffered.length > 0) yield this.buffered.shift() as T
      if (this.ended) break
      await new Promise<void>((resolve) => { this.wake = resolve })
      this.wake = undefined
    }
    if (this.failure !== undefined) throw this.failure
  }
}

export default AuthorizationController
