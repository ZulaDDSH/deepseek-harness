import { describe, expect, it, vi } from 'vitest'
import { createQuotaProviderRegistry } from '../src/providers.ts'

const credential = { value: 'test-key', source: 'test' }

describe('quota provider registry', () => {
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
