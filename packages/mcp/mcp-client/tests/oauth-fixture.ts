import type { IncomingMessage, ServerResponse } from 'node:http'
import { startHttpMcpFixture, type HttpMcpFixture } from './http-fixture.ts'

export interface OAuthMcpFixture extends HttpMcpFixture {
  registrations: number
  refreshes: number
  accept(token: string): void
  expire(): void
  rejectRefresh(code?: 'invalid_grant' | 'server_error'): void
  acceptRefresh(): void
  dropAuthorizationServer(): void
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
}

export async function startOAuthMcpFixture(): Promise<OAuthMcpFixture> {
  const accepted = new Set<string>()
  let origin = ''
  let tokenCount = 0
  let refreshRejected: 'invalid_grant' | 'server_error' | undefined
  let dropTokens = false
  const state = { registrations: 0, refreshes: 0 }
  const issue = (response: ServerResponse): void => {
    tokenCount += 1
    accepted.add(`access-${String(tokenCount)}`)
    json(response, 200, {
      access_token: `access-${String(tokenCount)}`, token_type: 'Bearer', refresh_token: `refresh-${String(tokenCount)}`, expires_in: 3600,
    })
  }
  const fixture = await startHttpMcpFixture(async (request, response) => {
    const url = new URL(request.url ?? '/', origin)
    if (dropTokens && url.pathname !== '/mcp') {
      request.socket.destroy()
      return true
    }
    switch (url.pathname) {
      case '/mcp': {
        const header = request.headers.authorization
        if (header !== undefined && accepted.has(header.replace(/^Bearer /, ''))) return false
        response.writeHead(401, {
          'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        }).end()
        return true
      }
      case '/.well-known/oauth-protected-resource/mcp':
        json(response, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] })
        return true
      case '/.well-known/oauth-authorization-server':
        json(response, 200, {
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        })
        return true
      case '/register': {
        state.registrations += 1
        const metadata = JSON.parse(await body(request)) as Record<string, unknown>
        json(response, 201, { ...metadata, client_id: 'client-1' })
        return true
      }
      case '/authorize': {
        const redirect = new URL(url.searchParams.get('redirect_uri') ?? '')
        redirect.searchParams.set('code', 'code-1')
        redirect.searchParams.set('state', url.searchParams.get('state') ?? '')
        redirect.searchParams.set('iss', origin)
        response.writeHead(302, { location: redirect.toString() }).end()
        return true
      }
      case '/token': {
        const form = new URLSearchParams(await body(request))
        if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'code-1' && form.has('code_verifier')) {
          issue(response)
        } else if (form.get('grant_type') === 'refresh_token' && refreshRejected === undefined && form.get('refresh_token')?.startsWith('refresh-') === true) {
          state.refreshes += 1
          issue(response)
        } else {
          const failure = form.get('grant_type') === 'refresh_token' ? refreshRejected ?? 'invalid_grant' : 'invalid_grant'
          json(response, failure === 'server_error' ? 500 : 400, { error: failure })
        }
        return true
      }
      default:
        return false
    }
  })
  origin = new URL(fixture.url).origin
  return {
    ...fixture,
    get registrations() { return state.registrations },
    get refreshes() { return state.refreshes },
    accept: (token: string) => { accepted.add(token) },
    expire: () => { accepted.clear() },
    rejectRefresh: (code = 'invalid_grant') => { refreshRejected = code },
    acceptRefresh: () => { refreshRejected = undefined },
    dropAuthorizationServer: () => { dropTokens = true },
  }
}
