import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { auth } from '@modelcontextprotocol/client'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { ConnectionAuth } from './connection.ts'
import type { Config } from './index.ts'
import {
  GrantProvider, grantAuthProvider, grantKey, hasAuthorizationHeader, memoryGrantStore, recordGrantStore,
} from './oauth.ts'

const SIGN_IN_TIMEOUT_MS = 300_000

const DONE_PAGE = '<!doctype html><meta charset="utf-8"><title>DeepSeek Harness</title>'
  + '<p>You can close this tab and return to DeepSeek Harness.</p>'

export interface CallbackListener {
  redirectUrl: string
  params: Promise<URLSearchParams>
  close(): void
}

export async function listenForCallback(signal: AbortSignal, timeoutMs = SIGN_IN_TIMEOUT_MS): Promise<CallbackListener> {
  const params = Promise.withResolvers<URLSearchParams>()
  params.promise.catch(() => {})
  const server = createServer((request, response) => {
    const url = new URL(String(request.url), 'http://127.0.0.1')
    if (url.pathname !== '/callback') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE)
    params.resolve(url.searchParams)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const timer = setTimeout(() => { params.reject(new Error('Sign-in timed out')) }, timeoutMs)
  timer.unref()
  const cancel = (): void => { params.reject(new Error('Sign-in was cancelled')) }
  if (signal.aborted) cancel()
  signal.addEventListener('abort', cancel, { once: true })
  const { port } = server.address() as AddressInfo
  return {
    redirectUrl: `http://127.0.0.1:${String(port)}/callback`,
    params: params.promise,
    close: () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      server.close()
      server.closeAllConnections()
    },
  }
}

export async function signIn(serverName: string, url: string, session: AuthorizationSession): Promise<void> {
  const callback = await listenForCallback(session.signal)
  try {
    const store = memoryGrantStore(url)
    const provider = new GrantProvider(store, callback.redirectUrl, (authorizationUrl) => {
      session.notify({ message: `Open this page to sign in to ${serverName}.`, url: authorizationUrl.toString() })
    })
    await auth(provider, { serverUrl: url })
    const params = await callback.params
    if (params.get('state') !== provider.expectedState) throw new Error('The sign-in response did not match this attempt')
    const code = params.get('code')
    if (code === null) throw new Error(`${serverName} refused the sign-in`)
    const iss = params.get('iss')
    await auth(provider, { serverUrl: url, authorizationCode: code, ...iss === null ? {} : { iss } })
    await session.commit({ kind: 'grant', payload: await store.read() })
  } finally {
    callback.close()
  }
}

export function registerOAuthFlow(ctx: Context, serverName: string, url: string, key: CredentialKey): void {
  ctx.inject(['authorization'], (inner) => {
    inner.authorization.registerFlow({
      key,
      label: `${serverName} (MCP)`,
      methods: [{ id: 'oauth', label: 'Sign in' }],
      run: session => signIn(serverName, url, session),
    })
  })
}

export function offerSignIn(ctx: Context, config: Config): ConnectionAuth | undefined {
  if (config.transport !== 'streamable-http' || hasAuthorizationHeader(config)) return undefined
  const key = grantKey(config.serverName)
  registerOAuthFlow(ctx, config.serverName, config.url, key)
  return { key, provider: grantAuthProvider(config.serverName, recordGrantStore(ctx, key, config.url)) }
}
