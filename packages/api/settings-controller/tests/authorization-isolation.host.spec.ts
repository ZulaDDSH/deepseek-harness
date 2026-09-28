/**
 * The authorization namespace as two real browser clients share one Host.
 *
 * Driving the controller directly cannot show what the transport does with a
 * notice. Here one Host, one gateway, and one authorization registry serve two
 * independent Remote clients, each on its own WebSocket carrier — the
 * arrangement two browser tabs actually have. A notice carries an authorization
 * URL, a device code, or a question, so what these pin is that the carrier is
 * what keeps one client's sign-in out of another's, and that the capability is
 * what keeps a second client from acting on it.
 *
 * The wire is real: a WebServer, the Typert gateway, Connection, the generated
 * Remote protocol, and two separate mux WebSockets. Only the flow and the
 * credential records are fixtures.
 */

import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { apply as applyConnection, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { RemoteStreamMuxClient } from '@deepseek-ai/dsh-api-gateway/src/client/stream-client.ts'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { z } from 'zod'
import AuthorizationController from '../src/authorization.ts'
import type { AuthorizationNotice, AuthorizationStart } from '../src/types.ts'

const CODEX = credentialKey('llm-pi-ai', 'openai-codex')
const KEY = 'llm-pi-ai/openai-codex'
const METHOD = 'oauth'

/** One item the attempt stream delivers, decoded off the wire. */
type BeginItem = AuthorizationStart | AuthorizationNotice | { readonly type: 'end'; readonly status: string }

const roots: Context[] = []
const restoreGlobals: (() => void)[] = []

afterEach(async () => {
  for (const restore of restoreGlobals.splice(0).reverse()) restore()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/**
 * Boot one Host serving the authorization namespace over a real WebSocket.
 * @param script - what the registered flow does before it commits its record.
 * @returns the Host context and the address a browser tab connects to.
 */
async function bootHost(script: (session: AuthorizationSession) => Promise<void> | void): Promise<{
  ctx: Context
  streamBaseUrl: string
  cookie: string
}> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  provideCredentialRecords(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService, {})
  await ctx.plugin({ inject: [...connectionInject], apply: applyConnection })
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(AuthorizationController)
  ctx.authorization.registerFlow({
    key: CODEX,
    label: 'OpenAI (ChatGPT Plus/Pro)',
    methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
    async run(session) {
      await script(session)
      await ctx.credentials.modifyRecord(CODEX, () => Promise.resolve({
        kind: 'grant',
        payload: { type: 'oauth', access: 'at', refresh: 'rt', expires: 1 },
      }))
    },
  })
  ctx.typert.register({
    package: '@deepseek-ai/dsh-api-settings-controller',
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: AUTHORIZATION_DESCRIPTORS,
  })
  return {
    ctx,
    streamBaseUrl: `http://127.0.0.1:${String(ctx.webServer.port)}`,
    cookie: browserCookie(ctx),
  }
}

/**
 * The `authorization.begin` stream descriptor, which is what the gateway claims
 * the endpoint from. Only the method this suite drives is declared.
 */
const AUTHORIZATION_DESCRIPTORS: InvocationDescriptor[] = [{
  id: '@deepseek-ai/dsh-api-settings-controller#authorization/begin',
  service: 'authorizationController',
  namespace: 'authorization',
  method: 'begin',
  mode: 'stream',
  invocation: { kind: 'direct' },
  parameters: [
    { name: 'key', wire: 'key', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', create: () => z.string() } },
    { name: 'method', wire: 'method', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', create: () => z.string().optional() } },
  ],
  result: {
    mode: 'strict',
    typeSymbol: '@deepseek-ai/dsh-api-settings-controller#BeginItem',
    create: () => z.unknown(),
  },
  cancellation: { parameter: 'signal' },
}]

/** Exchange this Host's process token for its browser Cookie header. */
function browserCookie(ctx: Context): string {
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const target = new URL(ctx.connection.authenticatedUrl(origin))
  let setCookie: string | undefined
  ctx.connection.authorizeIndex({
    method: 'GET',
    url: `${target.pathname}${target.search}`,
    headers: { host: target.host },
  }, {
    writeHead(_status: number, headers?: Readonly<Record<string, string>>) {
      setCookie = headers?.['set-cookie']
    },
    end() {},
  })
  if (setCookie === undefined) throw new Error('the isolation fixture did not receive a browser cookie')
  return setCookie.split(';', 1)[0]!
}

/** An in-memory credential-record owner the flows commit through. */
function provideCredentialRecords(ctx: Context): void {
  const records = new Map<CredentialKey, CredentialRecord>()
  ctx.provide('credentials', {
    async modifyRecord(
      key: CredentialKey,
      mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
    ): Promise<CredentialRecord | undefined> {
      const current = records.get(key)
      const next = await mutate(current)
      if (next === undefined) return current
      records.set(key, next)
      // The authorization seam confirms a flow's commit by observing this
      // event, so a record store that stays silent reports NOT_COMMITTED.
      ctx.emit('credentials/record-updated', key)
      return next
    },
    async describeRecord(key: CredentialKey): Promise<{ configured: boolean }> {
      return { configured: records.has(key) }
    },
  } as never)
}

/** One browser tab: its own WebSocket, its own cookie, its own mux client. */
interface Tab {
  /** Every item this tab's attempt stream received, in order. */
  readonly items: BeginItem[]
  readonly start: () => AuthorizationStart | undefined
  readonly notices: () => AuthorizationNotice[]
  /** Resolves once `predicate` holds over the items received so far. */
  readonly until: (predicate: () => boolean) => Promise<void>
  /** Resolves when this tab's attempt stream ended or failed. */
  readonly settled: Promise<void>
  readonly failure: () => unknown
  readonly close: () => Promise<void>
}

/**
 * Open one browser tab. Each tab installs its own `WebSocket` and
 * `__DSH_TRANSPORT__` while the mux client constructs its carrier, which is
 * exactly how two browser tabs differ: two sockets, one Host.
 * @param streamBaseUrl - the Host's HTTP origin.
 * @param cookie - the browser cookie this tab presents.
 * @param options - `idle` connects the carrier without opening an attempt, so
 *   the tab is a listening client that started nothing.
 * @returns the tab's stream recorder and control handles.
 */
async function openTab(
  streamBaseUrl: string,
  cookie: string,
  options: { readonly idle?: boolean } = {},
): Promise<Tab> {
  const items: BeginItem[] = []
  let start: AuthorizationStart | undefined
  const notices: AuthorizationNotice[] = []
  let failure: unknown
  let settle: () => void = () => {}
  const settled = new Promise<void>((resolve) => { settle = resolve })
  /** Poll until the tab has received what the caller is waiting for. */
  const waitUntil = async (predicate: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (predicate()) return
      if (failure !== undefined) throw failure
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('the tab never received the awaited item')
  }

  // The mux client opens the carrier itself, so this tab's socket is what its
  // constructor must find. The transport stub carries the browser cookie the
  // Host authenticates the upgrade with. Both globals are restored once the
  // client has been constructed, so the next tab starts from a clean slate.
  const restoreWebSocket = stubGlobal('WebSocket', cookieSocket(cookie))
  const restoreTransport = stubGlobal('__DSH_TRANSPORT__', { streamBaseUrl })
  const client = new RemoteStreamMuxClient()
  const controller = new AbortController()
  // An idle tab still connects: its carrier is up and its socket is attached to
  // the Host's mux, which is what a second browser tab has before it does
  // anything. Only the attempt is withheld.
  const stream = client.open('authorization/begin', { args: { key: KEY, method: METHOD } }, controller.signal)
  client.start()
  if (options.idle === true) {
    restoreWebSocket()
    restoreTransport()
    // Give the carrier a moment to attach before the caller starts an attempt.
    await new Promise(resolve => setTimeout(resolve, 50))
    return {
      items,
      start: () => start,
      notices: () => notices,

      until: waitUntil,
      settled,
      failure: () => failure,
      close: async () => {
        controller.abort(new Error('tab closed'))
        await client.close().catch(() => undefined)
      },
    }
  }
  void (async () => {
    try {
      for await (const item of stream as AsyncIterable<BeginItem>) {
        items.push(item)
        if (item.type === 'start') start = item
        else if (item.type === 'notice') notices.push(item)
      }
    } catch (error: unknown) {
      failure = error
    } finally {
      settle()
    }
  })()
  restoreWebSocket()
  restoreTransport()

  return {
    items,
    start: () => start,
    notices: () => notices,

    until: waitUntil,
    settled,
    failure: () => failure,
    close: async () => {
      controller.abort(new Error('tab closed'))
      await client.close().catch(() => undefined)
    },
  }
}

/** The `WebSocket` this tab's mux client uses: one socket, this tab's cookie. */
function cookieSocket(cookie: string): typeof WebSocket {
  return new Proxy(WebSocket, {
    construct(target, [address, protocols]: [string | URL, string | string[] | undefined]) {
      return new target(address, protocols, { headers: { cookie } })
    },
  })
}

/** Install one global for the duration of `use`, returning the restore. */
function stubGlobal(name: string, value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  const restore = (): void => {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, name)
    else Object.defineProperty(globalThis, name, descriptor)
  }
  restoreGlobals.push(restore)
  return restore
}

describe('two browser clients sharing one authorization Host', () => {
  it('never delivers a notice to the tab that started no attempt', async () => {
    const { streamBaseUrl, cookie } = await bootHost(async (session) => {
      session.notify({ message: 'Open this page', url: 'https://auth.example/start', code: 'TAB-A-SECRET' })
    })
    // B holds a connected carrier to the same Host and opens no attempt.
    const b = await openTab(streamBaseUrl, cookie, { idle: true })
    const a = await openTab(streamBaseUrl, cookie)

    await a.settled

    // The notice reached the tab that opened the attempt and no other: the
    // carrier, not a naming convention, is what keeps tabs apart. A broadcast
    // would put A's device code on every connected tab, B included.
    expect(a.notices().map(notice => notice.code)).toEqual(['TAB-A-SECRET'])
    expect(b.items).toEqual([])
    await a.close()
    await b.close()
  })

  it('refuses a tab acting on a capability it never received', async () => {
    let answered = ''
    const { ctx, streamBaseUrl, cookie } = await bootHost(async (session) => {
      answered = await session.prompt({ kind: 'text', message: 'Paste the code' })
    })
    // B is a connected second tab that started no attempt, so the capability A
    // received is one B was never shown.
    const b = await openTab(streamBaseUrl, cookie, { idle: true })
    const a = await openTab(streamBaseUrl, cookie)

    await a.until(() => a.notices().some(notice => notice.prompt !== undefined))
    const question = a.notices().find(notice => notice.prompt !== undefined)
    expect(question).toBeDefined()
    const capability = a.start()?.attempt

    // The only capability B could present is a guess, and the Host refuses it
    // without disturbing the attempt A is still driving.
    expect(failureCode(() => { ctx.authorizationController.answer('guessed', question?.prompt ?? '', 'stolen') }))
      .toBe('authorization/not-found')
    expect(failureCode(() => { ctx.authorizationController.cancel('guessed') }))
      .toBe('authorization/not-found')

    ctx.authorizationController.answer(capability ?? '', question?.prompt ?? '', 'mine')
    await a.settled
    expect(answered).toBe('mine')
    expect(a.failure()).toBeUndefined()
    expect(b.items).toEqual([])
    await a.close()
    await b.close()
  })

  it('cancels a live attempt through the real carrier', async () => {
    let aborted = false
    const { ctx, streamBaseUrl, cookie } = await bootHost(async (session) => {
      await new Promise<void>((resolve) => {
        if (session.signal.aborted) resolve()
        else session.signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
      aborted = true
    })
    const a = await openTab(streamBaseUrl, cookie)
    await a.until(() => a.start() !== undefined)

    ctx.authorizationController.cancel(a.start()?.attempt ?? '')
    await a.until(() => aborted)

    // The withdrawal reaches the flow and the stream reports it as an outcome
    // rather than a carrier failure.
    await a.settled
    expect(a.failure()).toBeUndefined()
    expect(a.items.at(-1)).toMatchObject({ type: 'end', status: 'cancelled' })
    await a.close()
  })
})

/** The Remote failure code a synchronous controller call threw. */
function failureCode(call: () => void): string | undefined {
  try {
    call()
    return undefined
  } catch (error: unknown) {
    return (error as { code?: string }).code
  }
}
