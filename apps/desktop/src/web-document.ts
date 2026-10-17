/** Local Web document and authenticated HTTP forwarding for the application window. */
import { readFile } from 'node:fs/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
}
const BOOT = '<script>globalThis.__DSH_BOOT_READY__ = Promise.withResolvers()</script>'

/**
 * Read an application-owned static asset; the index waits for asynchronous Host injections.
 * @param request - Local application request.
 * @param root - Packaged Web dist directory.
 * @returns Static response, or a missing/invalid path response.
 */
export async function serveWebDocument(request: Request, root: string): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
  const url = new URL(request.url)
  let pathname: string
  try { pathname = decodeURIComponent(url.pathname) } catch { return new Response(null, { status: 400 }) }
  const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  const directory = resolve(root)
  if (!target.startsWith(directory + sep)) return new Response(null, { status: 403 })
  let body: Buffer
  try { body = await readFile(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 })
    throw error
  }
  const content = pathname === '/' || pathname === '/index.html'
    ? body.toString().replace('<head>', '<head>' + BOOT) : new Uint8Array(body)
  return new Response(request.method === 'HEAD' ? null : content, {
    headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' },
  })
}

/**
 * Exchange the Host launch URL for an authority-bound browser cookie.
 * @param url - Authenticated URL reported by the owned Host process.
 * @returns Cookie header for requests forwarded to that Host.
 */
export async function authenticateWebHost(url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'manual' })
  const cookie = response.headers.get('set-cookie')
  await response.body?.cancel()
  if (response.status !== 303 || cookie === null) throw new Error('Desktop Host authentication failed')
  const end = cookie.indexOf(';')
  return end < 0 ? cookie : cookie.slice(0, end)
}

/**
 * Response headers not relayed to the renderer: `set-cookie` would hand the
 * Host's authentication cookie to the page, which the shell owns instead; the
 * rest are hop-by-hop fields of the Host connection.
 */
const WITHHELD_RESPONSE_HEADERS = [
  'set-cookie',
  'transfer-encoding', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade', 'proxy-authenticate', 'proxy-authorization',
]

const WITHHELD_REQUEST_HEADERS = ['host', 'origin', 'cookie', 'sec-fetch-site', 'accept-encoding']

const NULL_BODY_STATUSES: readonly number[] = [204, 205, 304]

/** Host routes whose responses carry immutable cache headers keyed by a per-process revision. */
const PLUGIN_BUNDLE_PATH = /^\/plugins\//u

/**
 * Forward local application requests to its authenticated Host, preserving streaming and cancellation.
 * Plugin bundle responses lose their `cache-control` for `no-store`: the Host marks them immutable
 * under a revision that changes every launch, so Chromium's disk cache would only accumulate bundles
 * no later launch can reuse.
 * @param request - Request from the application origin.
 * @param host - Owned Host URL.
 * @param cookie - Host-issued authentication cookie.
 * @returns Host response without connection-level headers.
 */
export async function forwardWebRequest(request: Request, host: string, cookie: string): Promise<Response> {
  const source = new URL(request.url)
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== 'dsh-app://app') return new Response(null, { status: 403 })
  const target = new URL(host)
  target.pathname = source.pathname
  target.search = source.search
  const headers = new Headers(request.headers)
  for (const name of WITHHELD_REQUEST_HEADERS) headers.delete(name)
  headers.set('cookie', cookie)
  const upstream = await requestHost(target, request.method, headers, request.body, request.signal)
  const outgoing = new Headers()
  for (let index = 0; index < upstream.rawHeaders.length; index += 2) {
    outgoing.append(upstream.rawHeaders[index] ?? '', upstream.rawHeaders[index + 1] ?? '')
  }
  for (const name of WITHHELD_RESPONSE_HEADERS) outgoing.delete(name)
  if (PLUGIN_BUNDLE_PATH.test(source.pathname)) outgoing.set('cache-control', 'no-store')
  const status = upstream.statusCode ?? 502
  if (request.method === 'HEAD' || NULL_BODY_STATUSES.includes(status)) {
    upstream.resume()
    return new Response(null, { status, headers: outgoing })
  }
  return new Response(Readable.toWeb(upstream) as ReadableStream<Uint8Array>, { status, headers: outgoing })
}

/** The renderer's abort reason as an Error, so a torn-down request always rejects with one. */
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Host request aborted')
}

/**
 * Open one Host request; aborting `signal` destroys it before or after headers.
 * @param target - Host URL carrying the forwarded path and query.
 * @param method - Request method.
 * @param headers - Forwarded request headers.
 * @param body - Upload stream, or null for a bodyless request.
 * @param signal - Renderer cancellation for this request.
 * @returns the Host response message once its headers arrive.
 */
function requestHost(
  target: URL,
  method: string,
  headers: Headers,
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal))
      return
    }
    const outgoing = httpRequest(target, { method, headers: Object.fromEntries(headers) }, resolve)
    outgoing.on('error', reject)
    signal.addEventListener('abort', () => { outgoing.destroy(abortError(signal)) }, { once: true })
    if (body === null) outgoing.end()
    else pipeline(Readable.fromWeb(body as NodeWebReadableStream<Uint8Array>), outgoing).catch(reject)
  })
}
