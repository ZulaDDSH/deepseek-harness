import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authenticateWebHost, forwardWebRequest, serveWebDocument } from '../src/web-document.ts'

const roots: string[] = []
const servers: Server[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.close(() => { resolve() })
    server.closeAllConnections()
  })))
})

async function fakeHost(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/?token=secret`
}

it('serves the Web entry and assets without starting or contacting a Host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-web-'))
  roots.push(root)
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<html><head></head><body><script src="assets/entry.js"></script></body></html>')
  await writeFile(join(root, 'assets/entry.js'), 'globalThis.entryLoaded = true')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const response = await serveWebDocument(new Request('dsh-app://app/'), root)
  const html = await response.text()
  expect(html.indexOf('Promise.withResolvers()')).toBeLessThan(html.indexOf('assets/entry.js'))
  expect(await (await serveWebDocument(new Request('dsh-app://app/assets/entry.js'), root)).text()).toContain('entryLoaded')
  expect(fetch).not.toHaveBeenCalled()
  expect((await serveWebDocument(new Request('dsh-app://app/%2e%2e%2fprivate'), root)).status).toBe(403)
  expect((await serveWebDocument(new Request('dsh-app://app/missing.js'), root)).status).toBe(404)
})

it('requires the Host authentication exchange and retains only its cookie value', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 303, headers: { 'set-cookie': 'session=owned; HttpOnly; SameSite=Strict' } }))
    .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
  vi.stubGlobal('fetch', fetch)
  expect(await authenticateWebHost('http://127.0.0.1:1234/?token=owned')).toBe('session=owned')
  await expect(authenticateWebHost('http://127.0.0.1:1234/')).rejects.toThrow('authentication failed')
})

it('forwards upload bytes and Host credentials and relays the streamed response', async () => {
  const seen: Record<string, unknown> = {}
  const host = await fakeHost((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => {
      Object.assign(seen, {
        method: req.method, url: req.url, cookie: req.headers.cookie, origin: req.headers.origin, body: Buffer.concat(chunks).toString(),
      })
      res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'private=1' })
      res.write('stream')
      res.end()
    })
  })
  const request = new Request('dsh-app://app/api/upload?name=file', {
    method: 'POST', body: 'upload bytes', headers: { origin: 'dsh-app://app', cookie: 'untrusted' },
  })
  const response = await forwardWebRequest(request, host, 'session=owned')
  expect(seen).toEqual({ method: 'POST', url: '/api/upload?name=file', cookie: 'session=owned', body: 'upload bytes' })
  expect(response.headers.get('set-cookie')).toBeNull()
  expect(await response.text()).toBe('stream')
})

it('tears the Host connection down when the renderer cancels the request', async () => {
  let arrived!: () => void
  const received = new Promise<void>((resolve) => { arrived = resolve })
  let closed!: Promise<void>
  const host = await fakeHost((_req, res) => {
    closed = new Promise<void>((resolve) => { res.on('close', resolve) })
    arrived()
  })
  const controller = new AbortController()
  const pending = forwardWebRequest(new Request('dsh-app://app/api/slow', { signal: controller.signal }), host, 'session=owned')
  await received
  controller.abort(new Error('renderer cancelled'))
  await expect(pending).rejects.toThrow('renderer cancelled')
  await closed
})

it('waits past a client deadline for a Host response that arrives late', async () => {
  const host = await fakeHost((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      setTimeout(() => { res.end('late') }, 1000)
    }, 1000)
  })
  const response = await forwardWebRequest(new Request('dsh-app://app/api/compact'), host, 'session=owned')
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('late')
}, 10_000)

it('drops connection-level headers the Host wrote for its own transport', async () => {
  const host = await fakeHost((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/plain', 'cache-control': 'no-cache', etag: '"1"',
      connection: 'keep-alive', 'keep-alive': 'timeout=5', trailer: 'x', te: 'trailers',
    })
    res.end('body')
  })
  const response = await forwardWebRequest(new Request('dsh-app://app/api/read'), host, 'session=owned')
  for (const name of ['connection', 'keep-alive', 'trailer', 'te']) expect(response.headers.get(name)).toBeNull()
  expect(response.headers.get('content-type')).toBe('text/plain')
  expect(response.headers.get('cache-control')).toBe('no-cache')
  expect(response.headers.get('etag')).toBe('"1"')
  expect(await response.text()).toBe('body')
})

it('replaces the immutable cache header of plugin bundles with no-store and leaves other routes alone', async () => {
  const immutable = 'public, max-age=31536000, immutable'
  const host = await fakeHost((_req, res) => {
    res.writeHead(200, { 'cache-control': immutable })
    res.end('js')
  })
  const bundle = await forwardWebRequest(new Request('dsh-app://app/plugins/??a/client.js&rev=1'), host, 'c')
  expect(bundle.headers.get('cache-control')).toBe('no-store')
  const chunk = await forwardWebRequest(new Request('dsh-app://app/plugins/a/client.x.js?rev=1'), host, 'c')
  expect(chunk.headers.get('cache-control')).toBe('no-store')
  const asset = await forwardWebRequest(new Request('dsh-app://app/api/plugins/list'), host, 'c')
  expect(asset.headers.get('cache-control')).toBe(immutable)
})

it('refuses another page origin without forwarding its request', async () => {
  const response = await forwardWebRequest(new Request('dsh-app://app/api/read', { headers: { origin: 'https://other.example' } }), 'http://127.0.0.1:1/', 'session=owned')
  expect(response.status).toBe(403)
})
