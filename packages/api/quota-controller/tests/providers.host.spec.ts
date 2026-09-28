import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQuotaProviderRegistry } from '../src/providers.ts'

const credential = { value: 'test-key', source: 'test' }
afterEach(() => { vi.unstubAllGlobals() })

describe('quota provider registry', () => {
  it('uses the native fetch implementation and falls back to numeric CNY credit', async () => {
    const fetcher = vi.fn(async () => Response.json({ balance_infos: [{ currency: 'CNY', total_balance: 3 }] }))
    vi.stubGlobal('fetch', fetcher)
    await expect(createQuotaProviderRegistry().get('deepseek')?.fetch(credential))
      .resolves.toMatchObject({ ok: true, windows: { credits: { valueLabel: '¥3.00' } } })
    fetcher.mockResolvedValueOnce(Response.json({ usage: { rolling: { percent: 110 }, weekly: { percent: -10 } } }))
    await expect(createQuotaProviderRegistry().get('opencode-go')?.fetch(credential))
      .resolves.toMatchObject({ windows: { '5h': { usedPercent: 100, resetAt: null }, weekly: { usedPercent: 0 } } })
  })

  it.each([{}, { balance_infos: [] }, { balance_infos: [{ currency: 'EUR', total_balance: 1 }] },
    ...['', 'not-money', null].map(total_balance => ({ balance_infos: [{ currency: 'USD', total_balance }] })),
  ])('reports unparseable DeepSeek balance %j', async (payload) => {
    await expect(createQuotaProviderRegistry().get('deepseek')?.fetch(credential, async () => Response.json(payload)))
      .resolves.toMatchObject({ ok: false, error: 'DeepSeek quota data could not be parsed' })
  })

  it.each([null, 1, {}, { usage: null }, { usage: 'invalid' }, { usage: { rolling: null, weekly: 1, monthly: {} } },
    { usage: { rolling: { percent: '12', resetsAt: 'invalid', status: ' ' } } },
  ])('reports unparseable OpenCode quota %j', async (payload) => {
    await expect(createQuotaProviderRegistry().get('opencode-go')?.fetch(credential, async () => Response.json(payload)))
      .resolves.toMatchObject({ ok: false, error: 'OpenCode Go quota data could not be parsed' })
  })

  it('keeps a valid reset when the usage percentage is unavailable', async () => {
    await expect(createQuotaProviderRegistry().get('opencode-go')?.fetch(credential, async () => Response.json({
      usage: { rolling: { percent: null, resetsAt: '2026-09-18T12:00:00Z' } },
    }))).resolves.toMatchObject({ ok: true, windows: { '5h': { usedPercent: null, resetAt: Date.parse('2026-09-18T12:00:00Z') } } })
  })

  it.each(['deepseek', 'opencode-go'])('reports HTTP and transport failures for %s', async (id) => {
    const provider = createQuotaProviderRegistry().get(id)
    for (const status of [401, 403, 500]) {
      const result = await provider?.fetch(credential, async () => new Response('', { status }))
      expect(result?.ok).toBe(false)
      expect(result?.error).toContain(status === 500 ? 'HTTP 500' : 'authentication failed')
    }
    await expect(provider?.fetch(credential, () => Promise.reject(new Error('offline'))))
      .resolves.toMatchObject({ ok: false, error: 'offline' })
    await expect(provider?.fetch(credential, async () => { throw 'offline' }))
      .resolves.toMatchObject({ ok: false, error: 'Request failed' })
  })

  it('includes the built-in DeepSeek and OpenCode Go providers', () => {
    const registry = createQuotaProviderRegistry()
    expect([...registry.keys()]).toEqual(['deepseek', 'opencode-go'])
  })

  it('normalizes DeepSeek balance into a credits window', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ balance_infos: [{ currency: 'USD', total_balance: '12.5' }] }), { status: 200 }))
    const provider = createQuotaProviderRegistry().get('deepseek')
    expect(provider).toBeDefined()
    const result = await provider?.fetch(credential, fetcher)
    expect(result).toMatchObject({ ok: true, windows: { credits: { valueLabel: '$12.50' } } })
    expect(fetcher).toHaveBeenCalledWith('https://api.deepseek.com/user/balance', expect.any(Object))
  })

  it('normalizes OpenCode Go rolling windows and rejects malformed data', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ usage: {
      rolling: { percent: 12, resetsAt: '2026-09-18T12:00:00Z' },
      weekly: { percent: 34, resetsAt: '2026-09-20T12:00:00Z' },
      monthly: { percent: 56, resetsAt: '2026-10-01T12:00:00Z' },
    } }), { status: 200 }))
    const provider = createQuotaProviderRegistry().get('opencode-go')
    const result = await provider?.fetch(credential, fetcher)
    expect(result?.windows).toMatchObject({ '5h': { usedPercent: 12 }, weekly: { usedPercent: 34 }, monthly: { usedPercent: 56 } })

    const invalid = vi.fn(async () => new Response(JSON.stringify({ usage: {} }), { status: 200 }))
    await expect(provider?.fetch(credential, invalid)).resolves.toMatchObject({ ok: false, error: 'OpenCode Go quota data could not be parsed' })
  })

  it('passes an OpenCode Go window status through, keeping a status-only window', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ usage: {
      rolling: { status: 'ok', percent: 12, resetsAt: '2026-09-18T12:00:00Z' },
      weekly: { status: 'rate-limited' },
    } }), { status: 200 }))
    const provider = createQuotaProviderRegistry().get('opencode-go')
    const result = await provider?.fetch(credential, fetcher)
    expect(result?.windows).toMatchObject({
      '5h': { status: 'ok', usedPercent: 12 },
      weekly: { status: 'rate-limited', usedPercent: null, resetAt: null },
    })
  })
})
