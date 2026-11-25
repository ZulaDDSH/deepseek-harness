/** Native shell operations reuse authenticated Web RPC. */
import { describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { connectDesktopWelcome } from '../src/welcome-backend.ts'

function transport(preference?: string) {
  const namespaces = [
    { ns: 'locale', value: preference === undefined ? {} : { preference } },
  ]
  const send = vi.fn<Parameters<typeof connectDesktopWelcome>[1]>(async (_input, init) => {
    const { rpcId, method } = JSON.parse(init!.body as string) as { rpcId: string; method: string }
    let value: unknown
    if (method === 'settings/describe') value = { namespaces }
    else if (method === 'productAnalytics/enabled') value = true
    else if (method === 'productAnalytics/report') value = undefined
    return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
  })
  return { send }
}

const url = 'http://127.0.0.1:19387/'
const cookie = 'dsh-desktop-session=fixture-private'

describe('desktop welcome Web operations', () => {
  it('uses the Host-issued cookie for native RPC without a launch-token exchange', async () => {
    const host = transport()
    const backend = await connectDesktopWelcome(url, host.send, () => Promise.resolve(cookie))
    expect(await backend.analyticsEnabled()).toBe(true)
    for (const [input, init] of host.send.mock.calls) {
      expect(input).toMatch(/^http:\/\/127\.0\.0\.1:19387\/api\//u)
      expect(init).toMatchObject({ redirect: 'error', headers: { cookie } })
    }
  })

  it('sends the Host-issued cookie over real HTTP to the running Host contract', async () => {
    const server = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      if (request.headers.cookie !== cookie) {
        response.writeHead(401).end()
        return
      }
      const rpc = JSON.parse(body) as { rpcId: string; method: string }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        type: 'server-response', rpcId: rpc.rpcId, result: { ok: true, value: rpc.method === 'productAnalytics/enabled' },
      }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('test Host did not bind a TCP port')
      const backend = await connectDesktopWelcome(`http://127.0.0.1:${address.port}/`, fetch,
        () => Promise.resolve(cookie))
      expect(await backend.analyticsEnabled()).toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('keeps the explicit cookie when the session cookie jar holds legacy Host cookies', async () => {
    const server = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      if (request.headers.cookie !== cookie) {
        response.writeHead(401).end('unauthorized')
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        type: 'server-response', rpcId: (JSON.parse(body) as { rpcId: string }).rpcId, result: { ok: true, value: true },
      }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('test Host did not bind a TCP port')
      const jar = 'dsh-auth-legacy=stale'
      const chromium: Parameters<typeof connectDesktopWelcome>[1] = (input, init) => fetch(input, {
        ...init, headers: { ...(init?.headers as Record<string, string>), cookie: init?.credentials === 'omit' ? (init.headers as Record<string, string>).cookie! : jar },
      })
      const backend = await connectDesktopWelcome(`http://127.0.0.1:${address.port}/`, chromium, () => Promise.resolve(cookie))
      expect(await backend.analyticsEnabled()).toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('reads language without querying account or model providers', async () => {
    const host = transport('zh')
    const backend = await connectDesktopWelcome(url, host.send, () => Promise.resolve(cookie))
    host.send.mockClear()
    expect(await backend.readLocalePreference()).toBe('zh')
    expect(host.send).toHaveBeenCalledOnce()
    expect(host.send.mock.calls[0]![0]).toContain('/api/settings/describe')
  })

  it('submits native analytics through authenticated RPC with a bounded request', async () => {
    const host = transport()
    const backend = await connectDesktopWelcome(url, host.send, () => Promise.resolve(cookie))
    const event = { eventName: 'desktop_app_launch' as const, timestamp: 100, attributes: {} }
    await backend.report(event)
    const [input, init] = host.send.mock.calls.at(-1)!
    expect(input).toBe('http://127.0.0.1:19387/api/productAnalytics/report')
    expect(init?.headers).toMatchObject({ cookie })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init!.body as string)).toMatchObject({ payload: { args: { event } } })
  })

  it('refuses an unauthenticated Web launch', async () => {
    const send = vi.fn<Parameters<typeof connectDesktopWelcome>[1]>(async () => new Response(null, { status: 401 }))
    const backend = await connectDesktopWelcome(url, send, () => Promise.resolve(cookie))
    await expect(backend.analyticsEnabled()).rejects.toThrow('Web request failed: productAnalytics/enabled HTTP 401')
  })

  it('names the status and a bounded redacted body snippet when the Host refuses a request', async () => {
    const token = 'A'.repeat(43)
    const send = vi.fn<Parameters<typeof connectDesktopWelcome>[1]>(async () =>
      new Response(`unauthorized ${token}\n${'x '.repeat(5000)}`, { status: 401 }))
    const backend = await connectDesktopWelcome(url, send, () => Promise.resolve(cookie))
    const error = await backend.readLocalePreference().then(() => undefined, (failure: unknown) => failure as Error)
    expect(error?.message).toMatch(/^desktop welcome: Web request failed: settings\/describe HTTP 401 unauthorized \[redacted\] x x/u)
    expect(error?.message).not.toContain(token)
    expect(error?.message.length).toBeLessThan(300)
  })
})
