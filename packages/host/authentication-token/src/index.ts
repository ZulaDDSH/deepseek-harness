/** Default token authentication, HTTP exchanges, and entry URL contribution. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-credentials'
import { CONNECT_PATH } from '@deepseek-ai/dsh-client-connection'
import type { ConnectionTrustRequest, PeerScope } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { BrowserAuth, MAX_PENDING_API_PEERS, PENDING_API_PEER_DEADLINE_MS } from './browser-auth.ts'

/** Stable plugin name. */
export const name = 'host-authentication-token'
/** Services owning request admission and the persistent signing key. */
export const inject = ['connection', 'connection.authentication', 'credentials']

/** Default browser and API cookie lifetime. */
export interface Config {
  /** Absolute cookie lifetime in days; default 30. */
  cookieMaxAgeDays: number
  sessionGeneration: number
}

/** Validate cookie lifetime before preparing the token implementation. */
export const Config: z<Config> = z.object({
  cookieMaxAgeDays: z.natural().min(1).default(30),
  sessionGeneration: z.natural().default(0),
})

/**
 * Register the token provider and its optional Web transport integration.
 * @param ctx - plugin scope owning the shared Peer and registrations.
 * @param config - validated browser and API cookie lifetime.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const auth = await BrowserAuth.create(ctx[Context.root], ctx.credentials, config.cookieMaxAgeDays, config.sessionGeneration)
  const peer = ctx.connection.createPeer({ principal: { kind: 'owner' } })
  const apiPeers = new Map<PeerScope['id'], PeerScope>()
  ctx.connection.authentication.register({
    authenticate(request) {
      const secure = ctx.get('webServer')?.protocol === 'https:'
      if (auth.isAuthenticated(request, secure)) return peer
      const id = auth.authenticateApi(request, secure)
      return id === undefined ? undefined : apiPeers.get(id)
    },
  })
  ctx.inject(['webServer'], (webCtx) => {
    let active = true
    const sockets = new Map<PeerScope, () => Promise<void>>()
    const pending = new Map<PeerScope['id'], { peer: PeerScope; timer: ReturnType<typeof setTimeout> }>()
    const disposePeer = (peer: PeerScope): Promise<void> => peer.dispose().catch((error: unknown) => {
      console.error('[host-authentication-token] Peer release failed:', error)
    })
    const settlePending = (id: PeerScope['id']): void => {
      const entry = pending.get(id)
      if (entry === undefined) return
      clearTimeout(entry.timer)
      pending.delete(id)
    }
    webCtx.effect(() => async () => {
      active = false
      apiPeers.clear()
      const abandoned = [...pending.values()]
      for (const { peer } of abandoned) settlePending(peer.id)
      await Promise.all([
        ...abandoned.map(({ peer }) => disposePeer(peer)),
        ...[...sockets.values()].map(release => release()),
      ])
    }, 'host-authentication-token: API sockets')
    webCtx.on('webserver/request', async (request, response, next) => {
      const facts: ConnectionTrustRequest = request
      if (facts.socket?.destroyed || response.destroyed || facts.signal?.aborted) return
      if (!active) { await next(); return }
      const url = new URL(request.url ?? '/', 'http://dsh.invalid')
      if (url.pathname !== '/' || !url.searchParams.has('token')) {
        await next()
        return
      }
      auth.authorizeIndex(request, response, webCtx.webServer.protocol === 'https:')
    })
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: CONNECT_PATH, auth: 'anonymous',
      handler(request, response) {
        const facts: ConnectionTrustRequest = request
        if (facts.socket?.destroyed || response.destroyed || facts.signal?.aborted) return
        if (!active) {
          response.writeHead(401)
          response.end('unauthorized')
          return
        }
        auth.authorizeConnect(request, response, webCtx.webServer.protocol === 'https:', (interactions) => {
          if (pending.size >= MAX_PENDING_API_PEERS) return undefined
          const apiPeer = webCtx.connection.createPeer({ principal: { kind: 'owner' }, interactions })
          apiPeers.set(apiPeer.id, apiPeer)
          const timer = setTimeout(() => {
            pending.delete(apiPeer.id)
            apiPeers.delete(apiPeer.id)
            void disposePeer(apiPeer)
          }, PENDING_API_PEER_DEADLINE_MS)
          timer.unref()
          pending.set(apiPeer.id, { peer: apiPeer, timer })
          apiPeer.ctx.effect(() => () => { apiPeers.delete(apiPeer.id); settlePending(apiPeer.id) }, 'authentication-token: API credential')
          return apiPeer.id
        })
      },
    }), 'host-authentication-token: API connect')
    webCtx.on('webserver/upgrade', async (request, socket, _head, admittedPeer, next) => {
      if (admittedPeer === undefined) { await next(); return }
      if (new URL(request.url ?? '/', 'http://dsh.invalid').pathname !== '/api/remote.mux') {
        await next()
        return
      }
      if (apiPeers.get(admittedPeer.id) !== admittedPeer) {
        if (auth.authenticateApi(request, webCtx.webServer.protocol === 'https:') === admittedPeer.id) {
          socket.destroy()
          return
        }
        await next()
        return
      }
      if (!active || admittedPeer.signal.aborted) { socket.destroy(); return }
      settlePending(admittedPeer.id)
      if (sockets.has(admittedPeer)) {
        socket.end([
          'HTTP/1.1 409 Conflict',
          'Connection: close',
          'Content-Type: text/plain; charset=utf-8',
          'Content-Length: 8',
          '',
          'conflict',
        ].join('\r\n'))
        return
      }
      const closed = Promise.withResolvers<undefined>()
      let released: Promise<void> | undefined
      const release = (): Promise<void> => {
        if (released !== undefined) return released
        // Revocation precedes asynchronous Peer and stream cleanup.
        apiPeers.delete(admittedPeer.id)
        socket.destroy()
        released = Promise.all([
          closed.promise,
          admittedPeer.dispose().catch((error: unknown) => {
            console.error('[host-authentication-token] Peer release failed:', error)
          }),
        ]).then(() => {
          sockets.delete(admittedPeer)
          void disposeSocket()
        })
        return released
      }
      const failed = (): void => { void release() }
      const finish = (): void => {
        socket.removeListener('error', failed)
        socket.removeListener('close', finish)
        closed.resolve(undefined)
        void release()
      }
      sockets.set(admittedPeer, release)
      const disposeSocket = webCtx.effect(() => release, 'host-authentication-token: owned API socket')
      admittedPeer.ctx.effect(() => {
        socket.on('error', failed)
        socket.once('close', finish)
        return async () => {
          apiPeers.delete(admittedPeer.id)
          socket.destroy()
          // Await only the transport: release itself awaits this Peer disposer.
          await closed.promise
        }
      }, 'host-authentication-token: API socket')
      if (socket.closed) finish()
      if (socket.destroyed) { await release(); return }
      try {
        await next()
      } catch (error) {
        await release()
        throw error
      }
    })
  })
  ctx.on('webserver/entry-url', (baseUrl, entries) => {
    entries.push({ label: 'dsh web', url: auth.authenticatedUrl(baseUrl), open: true })
  })
}
