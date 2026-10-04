import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import { credentialKey, parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SdkErrorCode, SdkHttpError, UnauthorizedError, InsufficientScopeError } from '@modelcontextprotocol/client'
import { apply, type Config, type McpConnectionReport } from '../src/index.ts'
import {
  AuthRequiredError, grantAuthProvider, grantKey, hasAuthorizationHeader, isAuthRequired, memoryGrantStore, recordGrantStore,
} from '../src/oauth.ts'
import { listenForCallback } from '../src/oauth-flow.ts'
import { MemoryCredentials } from './memory-credentials.ts'
import { startOAuthMcpFixture, type OAuthMcpFixture } from './oauth-fixture.ts'

const roots: Context[] = []
const fixtures: OAuthMcpFixture[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(fixtures.splice(0).map(fixture => fixture.close()))
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.closeAllConnections()
    server.close(() => { resolve() })
  })))
})

function configFor(url: string, extra: Partial<Config> = {}): Config {
  return {
    transport: 'streamable-http', serverName: 'Oauth_Srv', url, headers: {}, headerEnv: {},
    toolCallTimeoutMs: 5000, failOnStartupError: false, reconnect: { enabled: false },
    ...extra,
  } as Config
}

async function mount(config: Config, withCredentials = true) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(McpResources)
  if (withCredentials) {
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(AuthorizationService)
  }
  await apply(ctx, config)
  return ctx
}

async function startFixture(): Promise<OAuthMcpFixture> {
  const fixture = await startOAuthMcpFixture()
  fixtures.push(fixture)
  return fixture
}

function report(ctx: Context): McpConnectionReport {
  const reports: McpConnectionReport[] = []
  ctx.emit('mcp-client/inventory', reports)
  expect(reports).toHaveLength(1)
  return reports[0] as McpConnectionReport
}

function callback(authorizationUrl: string, extra: Record<string, string> = {}): URL {
  const url = new URL(authorizationUrl)
  const target = new URL(url.searchParams.get('redirect_uri') ?? '')
  target.searchParams.set('state', url.searchParams.get('state') ?? '')
  for (const [name, value] of Object.entries(extra)) target.searchParams.set(name, value)
  return target
}

async function approve(authorizationUrl: string): Promise<void> {
  const consent = await fetch(authorizationUrl, { redirect: 'manual' })
  await fetch(consent.headers.get('location') ?? '')
}

function signIn(ctx: Context, onNotice: (url: string) => void | Promise<void>, signal?: AbortSignal) {
  return ctx.authorization.begin({
    key: parseCredentialKey(report(ctx).authKey ?? ''),
    ...signal === undefined ? {} : { signal },
    interaction: {
      notify: (notice) => { if (notice.url !== undefined) void onNotice(notice.url) },
      prompt: () => Promise.reject(new Error('no prompt expected')),
    },
  })
}

const ping = (ctx: Context) => ctx.tools.execute({
  name: 'mcp__Oauth_Srv__ping', arguments: {}, callId: ToolCallId('ping'), signal: new AbortController().signal,
})

const listResources = (ctx: Context) => ctx.tools.execute({
  name: 'list_mcp_resources', arguments: { server: 'Oauth_Srv' }, callId: ToolCallId('list'), signal: new AbortController().signal,
})

describe('MCP OAuth sign-in', () => {
  it('waits for sign-in without retrying, then connects once the grant is stored', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url, { reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 2, maxAttempts: 3 } }))
    expect(report(ctx)).toMatchObject({ state: 'auth-required', toolCount: 0 })
    expect(report(ctx).error).toBeUndefined()
    const attempts = fixture.authorization.length
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(fixture.authorization.length).toBe(attempts)

    const outcome = await signIn(ctx, approve)
    expect(outcome.status).toBe('authorized')
    await vi.waitFor(() => { expect(report(ctx)).toMatchObject({ state: 'connected', toolCount: 1 }) })
    expect(fixture.registrations).toBe(1)
    expect((await ping(ctx)).isError).toBe(false)
    expect(fixture.authorization.at(-1)).toBe('Bearer access-1')
    const stored = await ctx.credentials.readRecord(parseCredentialKey(report(ctx).authKey ?? ''))
    expect(stored).toMatchObject({ kind: 'grant', payload: { url: fixture.url, tokens: { refresh_token: 'refresh-1' } } })
  })

  it('refreshes an expired token and stores the new one', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url))
    await signIn(ctx, approve)
    await vi.waitFor(() => { expect(report(ctx).state).toBe('connected') })
    fixture.expire()
    expect((await ping(ctx)).isError).toBe(false)
    expect(fixture.refreshes).toBe(1)
    const stored = await ctx.credentials.readRecord(parseCredentialKey(report(ctx).authKey ?? ''))
    expect(stored).toMatchObject({ payload: { tokens: { access_token: 'access-2' } } })
  })

  it.each(['invalid_grant', 'server_error'] as const)('tells the model to sign in again when a refresh fails with %s', async (code) => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url))
    await signIn(ctx, approve)
    await vi.waitFor(() => { expect(report(ctx).state).toBe('connected') })
    fixture.rejectRefresh(code)
    fixture.expire()
    const refused = await ping(ctx)
    expect(refused.isError, JSON.stringify(refused)).toBe(true)
    expect(JSON.stringify(refused)).toContain('requires sign-in')
  })

  it.each(['tool', 'resource'] as const)('asks for sign-in again when a %s request finds the grant revoked, then recovers', async (path) => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url, { reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 2, maxAttempts: 3 } }))
    await signIn(ctx, approve)
    await vi.waitFor(() => { expect(report(ctx)).toMatchObject({ state: 'connected', toolCount: 1 }) })
    fixture.rejectRefresh('invalid_grant')
    fixture.expire()
    const refused = path === 'tool' ? await ping(ctx) : await listResources(ctx)
    expect(refused.isError, JSON.stringify(refused)).toBe(true)
    await vi.waitFor(() => { expect(report(ctx)).toMatchObject({ state: 'auth-required' }) })
    expect(report(ctx).authKey).toBeDefined()
    const attempts = fixture.authorization.length
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(fixture.authorization.length).toBe(attempts)

    fixture.acceptRefresh()
    expect((await signIn(ctx, approve)).status).toBe('authorized')
    await vi.waitFor(() => { expect(report(ctx)).toMatchObject({ state: 'connected', toolCount: 1 }) })
    expect((await ping(ctx)).isError).toBe(false)
  })

  it('stays connected when the authorization server cannot be reached', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url))
    await signIn(ctx, approve)
    await vi.waitFor(() => { expect(report(ctx).state).toBe('connected') })
    fixture.dropAuthorizationServer()
    fixture.expire()
    expect((await ping(ctx)).isError).toBe(true)
    expect(report(ctx).state).toBe('connected')
  })

  it('asks for sign-in again when a refreshed token is still refused', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url, { reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 2, maxAttempts: 3 } }))
    await signIn(ctx, approve)
    await vi.waitFor(() => { expect(report(ctx)).toMatchObject({ state: 'connected', toolCount: 1 }) })
    fixture.refuseAccess()
    const refused = await ping(ctx)
    expect(refused.isError, JSON.stringify(refused)).toBe(true)
    expect(fixture.refreshes).toBe(1)
    await vi.waitFor(() => { expect(report(ctx)).toMatchObject({ state: 'auth-required' }) })
  })

  it('asks for sign-in instead of retrying when the server demands a wider scope', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url, { reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 2, maxAttempts: 3 } }))
    expect(report(ctx).state).toBe('auth-required')
    fixture.requireScope('mcp:tools')
    expect((await signIn(ctx, approve)).status).toBe('authorized')
    await vi.waitFor(() => { expect(report(ctx)).toMatchObject({ state: 'auth-required' }) })
  })

  it('asks for sign-in again when a live request is refused for insufficient scope', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url))
    await signIn(ctx, approve)
    await vi.waitFor(() => { expect(report(ctx)).toMatchObject({ state: 'connected', toolCount: 1 }) })
    fixture.requireScope('mcp:tools')
    const refused = await ping(ctx)
    expect(refused.isError, JSON.stringify(refused)).toBe(true)
    await vi.waitFor(() => { expect(report(ctx)).toMatchObject({ state: 'auth-required' }) })
  })

  it('passes a refresh failure that is not a revoked grant through unchanged', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url))
    await signIn(ctx, approve)
    await vi.waitFor(() => { expect(report(ctx).state).toBe('connected') })
    const key = parseCredentialKey(report(ctx).authKey ?? '')
    const provider = grantAuthProvider('srv', recordGrantStore(ctx, key, fixture.url))
    const unreachable = { response: new Response(null, { status: 401 }), serverUrl: new URL('http://127.0.0.1:1/mcp'), fetchFn: fetch }
    await expect(provider.onUnauthorized?.(unreachable)).rejects.not.toThrow('requires sign-in')
  })

  it('ignores a stored grant that belongs to a different server URL', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url))
    await signIn(ctx, approve)
    await vi.waitFor(() => { expect(report(ctx).state).toBe('connected') })
    const key = parseCredentialKey(report(ctx).authKey ?? '')
    await ctx.credentials.modifyRecord(key, async current => ({
      kind: 'grant', payload: { ...(current as { payload: object }).payload, url: 'http://elsewhere.test/mcp' },
    }))
    expect(await recordGrantStore(ctx, key, fixture.url).read()).toBeUndefined()
    await recordGrantStore(ctx, key, fixture.url).update({})
    expect((await recordGrantStore(ctx, key, fixture.url).read())?.tokens).toBeUndefined()
  })

  it('does not reconnect for another record or while already connected', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url))
    const attempts = fixture.authorization.length
    await ctx.credentials.modifyRecord(credentialKey('mcp-client', 'other'), async () => ({ kind: 'grant', payload: {} }))
    expect(report(ctx).state).toBe('auth-required')
    expect(fixture.authorization.length).toBe(attempts)
    await signIn(ctx, approve)
    await vi.waitFor(() => { expect(report(ctx).state).toBe('connected') })
    const connected = fixture.authorization.length
    const key = parseCredentialKey(report(ctx).authKey ?? '')
    await ctx.credentials.modifyRecord(key, async () => ({
      kind: 'grant', payload: { url: fixture.url, tokens: { access_token: 'access-1', token_type: 'Bearer' } },
    }))
    expect(fixture.authorization.length).toBe(connected)
  })

  it('accepts a callback without an issuer parameter', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url))
    const outcome = await signIn(ctx, async (url) => { await fetch(callback(url, { code: 'code-1' })) })
    expect(outcome.status).toBe('authorized')
  })

  it('rejects a callback whose state does not match the attempt', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url))
    await expect(signIn(ctx, async (url) => {
      await fetch(callback(url, { code: 'code-1', state: 'forged' }))
    })).rejects.toThrow('did not match this attempt')
    expect(report(ctx).state).toBe('auth-required')
  })

  it('reports a refusal from the authorization server', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url))
    await expect(signIn(ctx, async (url) => {
      await fetch(callback(url, { error: 'access_denied' }))
    })).rejects.toThrow('refused the sign-in')
  })

  it('is cancelled when the human withdraws', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url))
    const controller = new AbortController()
    const outcome = await signIn(ctx, () => { controller.abort() }, controller.signal)
    expect(outcome.status).toBe('cancelled')
  })

  it('offers no sign-in when the configuration carries its own Authorization header', async () => {
    const fixture = await startFixture()
    fixture.accept('static-token')
    const ctx = await mount(configFor(fixture.url, { headers: { Authorization: 'Bearer static-token' } }))
    expect(report(ctx)).toMatchObject({ state: 'connected', toolCount: 1 })
    expect(report(ctx).authKey).toBeUndefined()
    expect(ctx.authorization.list()).toEqual([])
  })

  it('reports a refused static credential as a failure with its reason', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url, { headers: { Authorization: 'Bearer wrong' } }))
    expect(report(ctx).state).toBe('failed')
    expect(report(ctx).error).toContain('401')
  })

  it('reports a connection failure with its reason', async () => {
    const ctx = await mount(configFor('http://127.0.0.1:1/mcp'))
    expect(report(ctx)).toMatchObject({ state: 'failed', toolCount: 0 })
    expect(report(ctx).error?.length).toBeGreaterThan(0)
  })

  it('reports connecting while the first attempt is pending', async () => {
    const hanging = createServer(() => {})
    servers.push(hanging)
    await new Promise<void>((resolve) => { hanging.listen(0, '127.0.0.1', resolve) })
    const { port } = hanging.address() as AddressInfo
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    void apply(ctx, configFor(`http://127.0.0.1:${String(port)}/mcp`))
    await vi.waitFor(() => { expect(report(ctx).state).toBe('connecting') })
  })

  it('works without a credentials service, reporting that sign-in is needed', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url), false)
    expect(report(ctx).state).toBe('auth-required')
    await expect(recordGrantStore(ctx, grantKey('x'), fixture.url).update({})).rejects.toThrow('no credentials service')
    expect(await recordGrantStore(ctx, grantKey('x'), fixture.url).read()).toBeUndefined()
  })
})

describe('OAuth helpers', () => {
  it('derives distinct, valid credential keys for any server name', () => {
    const keys = ['Docs', 'docs', 'my_server', '9lives', '-x'].map(grantKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(key.startsWith('mcp-client/srv-')).toBe(true)
  })

  it('detects an Authorization header by name or environment mapping, in any case', () => {
    expect(hasAuthorizationHeader({ headers: {}, headerEnv: {} })).toBe(false)
    expect(hasAuthorizationHeader({ headers: { authorization: 'x' } })).toBe(true)
    expect(hasAuthorizationHeader({ headers: {}, headerEnv: { AUTHORIZATION: 'TOKEN' } })).toBe(true)
    expect(hasAuthorizationHeader({ headers: {} })).toBe(false)
  })

  it('recognizes sign-in failures through wrapped causes', () => {
    const http = new SdkHttpError(SdkErrorCode.ClientHttpAuthentication, 'denied', { status: 401, statusText: 'x' })
    expect(isAuthRequired(new AuthRequiredError('s'))).toBe(true)
    expect(isAuthRequired(new UnauthorizedError())).toBe(true)
    expect(isAuthRequired(http)).toBe(true)
    expect(isAuthRequired(new Error('Error POSTing to endpoint (HTTP 401): '))).toBe(true)
    expect(isAuthRequired(new Error('outer', { cause: new AuthRequiredError('s') }))).toBe(true)
    expect(isAuthRequired(new InsufficientScopeError({ requiredScope: 'mcp:tools' }))).toBe(true)
    expect(isAuthRequired(new Error('connection refused'))).toBe(false)
    expect(isAuthRequired('HTTP 401')).toBe(false)
  })

  it('holds a grant in memory for one attempt', async () => {
    const store = memoryGrantStore('http://x/mcp')
    await store.update({ tokens: { access_token: 'a', token_type: 'Bearer' } })
    expect(await store.read()).toMatchObject({ url: 'http://x/mcp', tokens: { access_token: 'a' } })
  })

  it('refreshes through discovery when the challenge names no resource metadata', async () => {
    const fixture = await startFixture()
    const ctx = await mount(configFor(fixture.url))
    await signIn(ctx, approve)
    await vi.waitFor(() => { expect(report(ctx).state).toBe('connected') })
    const key = parseCredentialKey(report(ctx).authKey ?? '')
    const provider = grantAuthProvider('srv', recordGrantStore(ctx, key, fixture.url))
    await provider.onUnauthorized?.({ response: new Response(null, { status: 401 }), serverUrl: new URL(fixture.url), fetchFn: fetch })
    expect(fixture.refreshes).toBe(1)
    expect(await provider.token()).toBe('access-2')
  })

  it('has no token and requires sign-in when nothing is stored', async () => {
    const provider = grantAuthProvider('srv', memoryGrantStore('http://x/mcp'))
    expect(await provider.token()).toBeUndefined()
    const context = { response: new Response(null, { status: 401 }), serverUrl: new URL('http://x/mcp'), fetchFn: fetch }
    await expect(provider.onUnauthorized?.(context)).rejects.toThrow('requires sign-in')
  })
})

describe('loopback callback', () => {
  it('answers only the callback path', async () => {
    const listener = await listenForCallback(new AbortController().signal)
    try {
      expect((await fetch(new URL('/other', listener.redirectUrl))).status).toBe(404)
      const done = fetch(`${listener.redirectUrl}?code=c`)
      expect((await listener.params).get('code')).toBe('c')
      expect((await done).status).toBe(200)
    } finally {
      listener.close()
    }
  })

  it('rejects when withdrawn before it starts, and when it times out', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const withdrawn = await listenForCallback(aborted.signal)
    await expect(withdrawn.params).rejects.toThrow('cancelled')
    withdrawn.close()
    const slow = await listenForCallback(new AbortController().signal, 5)
    await expect(slow.params).rejects.toThrow('timed out')
    slow.close()
  })
})
