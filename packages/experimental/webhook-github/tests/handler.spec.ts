import { createHmac } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createGitHubWebhookHandler } from '../src/handler.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => { resolve() }))))
})

/** One mutable fake for credential rotation and dispatch observation. */
function fakeContext(secret = 'fixture-secret'): {
  ctx: Context
  dispatch: ReturnType<typeof vi.fn>
  setSecret(value: string | undefined): void
  warnings: ReturnType<typeof vi.fn>
} {
  let current = secret as string | undefined
  const dispatch = vi.fn()
  const warnings = vi.fn()
  return {
    ctx: {
      credentials: {
        resolve: async () => current === undefined ? undefined : { value: current, source: 'environment' },
      },
      webhookRuntime: { dispatch },
      logger: { warn: warnings },
    } as unknown as Context,
    dispatch,
    setSecret(value) { current = value },
    warnings,
  }
}

/** Start a real Node server around the package-owned route handler. */
async function serve(
  ctx: Context,
  maxBodyBytes = 1024,
  extra: { maxConcurrentRequests?: number; bodyTimeoutMs?: number; replayWindowMs?: number } = {},
): Promise<string> {
  const handler = createGitHubWebhookHandler(ctx, {
    source: 'primary',
    secretEnv: credentialRef('DSH_GITHUB_WEBHOOK_SECRET'),
    maxBodyBytes,
    ...extra,
  })
  const server = createServer((request, response) => { void handler(request, response) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return `http://127.0.0.1:${String(port)}`
}

/** HMAC header for one exact UTF-8 body. */
function signature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

/** Send one GitHub-shaped request. */
async function post(
  base: string,
  body: string,
  options: {
    secret?: string
    signature?: string
    event?: string
    delivery?: string
    contentType?: string
    method?: string
  } = {},
): Promise<Response> {
  const secret = options.secret ?? 'fixture-secret'
  return await fetch(base, {
    method: options.method ?? 'POST',
    headers: {
      'content-type': options.contentType ?? 'application/json',
      'x-hub-signature-256': options.signature ?? signature(secret, body),
      'x-github-event': options.event ?? 'pull_request',
      'x-github-delivery': options.delivery ?? 'delivery-1',
    },
    ...(options.method === 'GET' ? {} : { body }),
  })
}

/** Send body chunks without Content-Length through a real Node client socket. */
async function postChunked(
  base: string,
  chunks: readonly string[],
  endDelayMs = 0,
): Promise<{ body: string; status: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest(base, {
      method: 'POST',
      headers: {
        connection: 'close',
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
        'x-hub-signature-256': 'sha256=unused',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'chunked-delivery',
      },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { body += chunk })
      response.on('end', () => { resolve({ body, status: response.statusCode ?? 0 }) })
    })
    request.once('error', reject)
    request.once('socket', (socket) => { socket.setNoDelay(true) })
    for (const chunk of chunks) request.write(chunk)
    if (endDelayMs === 0) request.end()
    else setTimeout(() => { request.end() }, endDelayMs)
  })
}

describe('GitHub webhook HTTP handler', () => {
  it('verifies, projects, dispatches, and answers 202', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const body = JSON.stringify({ action: 'ready_for_review', number: 1 })
    const response = await post(base, body, { contentType: 'application/json; charset=utf-8' })
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
    expect(fake.dispatch).toHaveBeenCalledOnce()
    const dispatched: unknown = fake.dispatch.mock.calls[0]?.[0]
    expect(dispatched).toMatchObject({
      kind: 'github',
      source: 'primary',
      deliveryId: 'delivery-1',
      event: { name: 'pull_request', payload: { action: 'ready_for_review', number: 1 } },
    })
    expect(typeof (dispatched as { receivedAt?: unknown }).receivedAt).toBe('number')
  })

  it('resolves the secret for each request so rotation takes effect immediately', async () => {
    const fake = fakeContext('first')
    const base = await serve(fake.ctx)
    const body = JSON.stringify({ ping: true })
    expect((await post(base, body, { secret: 'first', delivery: 'first' })).status).toBe(202)
    fake.setSecret('second')
    expect((await post(base, body, { secret: 'first', delivery: 'stale' })).status).toBe(401)
    expect((await post(base, JSON.stringify({ ping: 2 }), { secret: 'second', delivery: 'second' })).status).toBe(202)
    expect(fake.dispatch).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['method', { method: 'GET' }, 405],
    ['content type', { contentType: 'text/plain' }, 415],
    ['content type parameter', { contentType: 'application/json; boundary=x' }, 415],
    ['content type parameters', { contentType: 'application/json; charset=utf-8; boundary=x' }, 415],
    ['signature', { signature: 'sha256=bad' }, 401],
    ['event header', { event: '' }, 400],
    ['delivery header', { delivery: '' }, 400],
  ] as const)('rejects an invalid %s before dispatch', async (_label, options, status) => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const response = await post(base, '{}', options)
    expect(response.status).toBe(status)
    if (status === 405) expect(response.headers.get('allow')).toBe('POST')
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('rejects a missing Content-Type before body processing', async () => {
    const fake = fakeContext()
    const handler = createGitHubWebhookHandler(fake.ctx, {
      source: 'primary',
      secretEnv: credentialRef('DSH_GITHUB_WEBHOOK_SECRET'),
      maxBodyBytes: 1024,
    })
    const request = { method: 'POST', headers: {}, headersDistinct: {} } as unknown as IncomingMessage
    const writeHead = vi.fn()
    const response = { setHeader: vi.fn(), writeHead, end: vi.fn() } as unknown as ServerResponse
    await handler(request, response)
    expect(writeHead).toHaveBeenCalledWith(415, expect.any(Object))
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('does not dispatch a replayed signed body even when the delivery or event headers change', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const body = JSON.stringify({ action: 'ready_for_review', number: 1 })
    expect((await post(base, body, { delivery: 'a' })).status).toBe(202)
    expect((await post(base, body, { delivery: 'a' })).status).toBe(202)
    expect((await post(base, body, { delivery: 'b', event: 'issues' })).status).toBe(202)
    expect(fake.dispatch).toHaveBeenCalledOnce()
    expect((await post(base, JSON.stringify({ action: 'ready_for_review', number: 2 }), { delivery: 'c' })).status).toBe(202)
    expect(fake.dispatch).toHaveBeenCalledTimes(2)
  })

  it('does not remember a body that failed verification or dispatch', async () => {
    const fake = fakeContext()
    fake.dispatch.mockImplementationOnce(() => { throw new Error('closing') })
    const base = await serve(fake.ctx)
    const body = JSON.stringify({ n: 1 })
    expect((await post(base, body, { signature: 'sha256=bad' })).status).toBe(401)
    expect((await post(base, body)).status).toBe(503)
    expect((await post(base, body)).status).toBe(202)
    expect(fake.dispatch).toHaveBeenCalledTimes(2)
  })

  it('dispatches repeated bodies when the replay window is disabled or has passed', async () => {
    const fake = fakeContext()
    const off = await serve(fake.ctx, 1024, { replayWindowMs: 0 })
    const body = JSON.stringify({ n: 1 })
    await post(off, body)
    await post(off, body)
    expect(fake.dispatch).toHaveBeenCalledTimes(2)
    const short = await serve(fake.ctx, 1024, { replayWindowMs: 20 })
    await post(short, body)
    await new Promise(resolve => setTimeout(resolve, 60))
    await post(short, body)
    expect(fake.dispatch).toHaveBeenCalledTimes(4)
  })

  it('rejects missing required headers without reading the body', async () => {
    const fake = fakeContext()
    const handler = createGitHubWebhookHandler(fake.ctx, {
      source: 'primary',
      secretEnv: credentialRef('DSH_GITHUB_WEBHOOK_SECRET'),
      maxBodyBytes: 1024,
    })
    const read = vi.fn()
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      headersDistinct: {},
      [Symbol.asyncIterator]() { read(); return { next: async () => ({ done: true, value: undefined }) } },
    } as unknown as IncomingMessage
    const writeHead = vi.fn()
    const response = { setHeader: vi.fn(), writeHead, end: vi.fn() } as unknown as ServerResponse
    await handler(request, response)
    expect(writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    expect(read).not.toHaveBeenCalled()
  })

  it('answers 429 beyond the concurrent request limit and recovers afterwards', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx, 1024, { maxConcurrentRequests: 1 })
    const slow = postChunked(base, ['{'], 300)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect((await post(base, '{}')).status).toBe(429)
    await slow
    expect((await post(base, '{}')).status).toBe(202)
  })

  it('rejects duplicate required headers', async () => {
    const fake = fakeContext()
    const handler = createGitHubWebhookHandler(fake.ctx, {
      source: 'primary',
      secretEnv: credentialRef('DSH_GITHUB_WEBHOOK_SECRET'),
      maxBodyBytes: 1024,
    })
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      headersDistinct: {
        'x-hub-signature-256': ['sha256=unused'],
        'x-github-delivery': ['delivery-1'],
        'x-github-event': ['pull_request', 'ping'],
      },
      complete: true,
      async * [Symbol.asyncIterator]() { yield Buffer.from('{}') },
    } as unknown as IncomingMessage
    const writeHead = vi.fn()
    const response = { setHeader: vi.fn(), writeHead, end: vi.fn() } as unknown as ServerResponse
    await handler(request, response)
    expect(writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it.each([
    ['not JSON', '{', 400],
    ['array', '[]', 400],
    ['non-lossless number', '{"value":1e400}', 400],
  ] as const)('rejects a signed %s body', async (_label, body, status) => {
    const fake = fakeContext()
    const base = await serve(fake.ctx)
    const response = await post(base, body)
    expect(response.status).toBe(status)
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('rejects a declared body over the configured cap', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx, 2)
    const response = await post(base, '{} ')
    expect(response.status).toBe(413)
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('answers 413 for a chunked body over the cap without resetting the connection', async () => {
    const fake = fakeContext()
    const base = await serve(fake.ctx, 2)

    await expect(postChunked(base, ['abc'], 50)).resolves.toEqual({
      body: 'request body is too large',
      status: 413,
    })
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('answers 503 when the credential or runtime is unavailable', async () => {
    const missing = fakeContext()
    missing.setSecret(undefined)
    const missingBase = await serve(missing.ctx)
    expect((await post(missingBase, '{}')).status).toBe(503)

    const closing = fakeContext()
    closing.dispatch.mockImplementation(() => { throw new Error('closing') })
    const closingBase = await serve(closing.ctx)
    expect((await post(closingBase, '{}')).status).toBe(503)
    expect(closing.warnings).toHaveBeenCalledTimes(1)
  })

  it('does not leak the signed payload or secret in an infrastructure diagnostic', async () => {
    const fake = fakeContext('super-secret')
    ;(fake.ctx.credentials.resolve as ReturnType<typeof vi.fn> | undefined) = vi.fn(async () => {
      throw new Error('credential store unavailable')
    }) as never
    const base = await serve(fake.ctx)
    const body = JSON.stringify({ private: 'payload-secret' })
    expect((await post(base, body, { secret: 'super-secret' })).status).toBe(503)
    const diagnostics = JSON.stringify(fake.warnings.mock.calls)
    expect(diagnostics).not.toContain('super-secret')
    expect(diagnostics).not.toContain('payload-secret')
  })
})
