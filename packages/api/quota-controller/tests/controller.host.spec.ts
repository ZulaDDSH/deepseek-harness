import { Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import { QuotaController } from '../src/index.ts'

const BUILT_IN = [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'opencode-go', name: 'OpenCode Go' }]

describe('QuotaController credential resolution', () => {
  it('uses the first resolved reference and coalesces only pending requests', async () => {
    const ctx = new Context()
    const credential = { value: 'fallback-key', source: 'test' }
    const resolve = vi.fn(async (ref: CredentialRef) => ref === 'OPENCODE_GO_API_KEY' ? credential : undefined)
    const readRecord = vi.fn(async () => undefined)
    ctx.provide('credentials', { resolve, readRecord } as never)
    let finish: ((value: Response) => void) | undefined
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { finish = resolve }))
    const controller = new QuotaController(ctx, { fetch: fetcher })
    const first = controller.fetch('opencode-go')
    expect(controller.fetch('opencode-go')).toBe(first)
    await vi.waitFor(() => { expect(fetcher).toHaveBeenCalledOnce() })
    if (finish === undefined) throw new Error('quota request did not start')
    finish(Response.json({ usage: { rolling: { percent: 1 } } }))
    await expect(first).resolves.toMatchObject({ ok: true })
    expect(readRecord).not.toHaveBeenCalled()
    fetcher.mockResolvedValueOnce(Response.json({ usage: { rolling: { percent: 2 } } }))
    await expect(controller.fetch('opencode-go')).resolves.toMatchObject({ windows: { '5h': { usedPercent: 2 } } })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(resolve.mock.calls.map(([ref]) => ref)).toEqual([
      'OPENCODE_API_KEY', 'OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY', 'OPENCODE_GO_API_KEY',
    ])
  })

  it.each([undefined, { kind: 'oauth' }, { kind: 'api-key' }, { kind: 'api-key', key: '' }])('lists both built-in providers and reports unset ones as not configured %j', async (record) => {
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => undefined, readRecord: async () => record } as never)
    const controller = new QuotaController(ctx)
    await expect(controller.listProviders()).resolves.toEqual(BUILT_IN)
    await expect(controller.fetch('deepseek-official')).resolves.toMatchObject({ configured: false, ok: false, error: 'Set up DeepSeek in Settings > Models' })
    await expect(controller.fetch('missing')).resolves.toMatchObject({ providerName: 'missing', error: 'Unsupported provider' })
  })

  it('lists DeepSeek once and fetches its balance', async () => {
    const ctx = new Context()
    ctx.provide('credentials', { resolve: vi.fn(async (ref: CredentialRef) => ref === 'DEEPSEEK_API_KEY'
      ? { value: 'stored-deepseek-key', source: 'test' }
      : undefined), readRecord: vi.fn(async () => undefined) } as never)
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ balance_infos: [{ currency: 'USD', total_balance: '4.5' }] }))
    const controller = new QuotaController(ctx, { fetch: fetchImpl })

    await expect(controller.listProviders()).resolves.toEqual(BUILT_IN)
    await expect(controller.fetch('deepseek-official')).resolves.toMatchObject({
      providerId: 'deepseek-official', ok: true, windows: { credits: { valueLabel: '$4.50' } },
    })
    expect(fetchImpl).toHaveBeenCalledWith('https://api.deepseek.com/user/balance', expect.any(Object))
  })

  it('lists custom providers without consulting the credential service, and rejects a missing one on fetch', async () => {
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => undefined, readRecord: async () => undefined } as never)
    const controller = new QuotaController(ctx, { providers: [{
      id: 'custom', name: 'Custom', credentialRef: 'CUSTOM_KEY' as CredentialRef,
      fetch: async () => ({ providerId: 'custom', providerName: 'Custom', configured: true, ok: true }),
    }] })
    await expect(controller.listProviders()).resolves.toEqual([...BUILT_IN, { id: 'custom', name: 'Custom' }])
    const unavailable = new QuotaController(new Context())
    await expect(unavailable.listProviders()).resolves.toEqual(BUILT_IN)
    const rejected = unavailable.fetch('deepseek-official')
    await expect(rejected).rejects.toMatchObject({ code: 'gateway/internal' })
    const retry = unavailable.fetch('deepseek-official')
    expect(retry).not.toBe(rejected)
    await expect(retry).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it('fetches a provider signed in through the Models page record', async () => {
    const key = credentialKey('llm-pi-ai', 'opencode-go')
    const credentials = {
      resolve: vi.fn(async () => undefined),
      readRecord: vi.fn(async (requested: typeof key) => requested === key
        ? { kind: 'api-key' as const, key: 'stored-opencode-key' }
        : undefined),
    }
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer stored-opencode-key')
      return new Response(JSON.stringify({ usage: { rolling: { percent: 12, resetsAt: '2026-09-18T12:00:00Z' } } }), { status: 200 })
    })
    const ctx = new Context()
    ctx.provide('credentials', credentials as never)
    const controller = new QuotaController(ctx, { fetch: fetchImpl })

    await expect(controller.listProviders()).resolves.toEqual(BUILT_IN)
    await expect(controller.fetch('opencode-go')).resolves.toMatchObject({
      providerId: 'opencode-go', configured: true, ok: true, windows: { '5h': { usedPercent: 12 } },
    })
    expect(credentials.resolve).toHaveBeenCalled()
    expect(credentials.readRecord).toHaveBeenCalledWith(key)
  })

  it('reports an unsupported provider for a model route that has no usage source', async () => {
    const ctx = new Context()
    ctx.provide('credentials', { resolve: vi.fn(async () => undefined), readRecord: vi.fn(async () => undefined) } as never)
    const controller = new QuotaController(ctx)

    await expect(controller.listProviders()).resolves.toEqual(BUILT_IN)
    await expect(controller.fetch('anthropic')).resolves.toEqual({
      providerId: 'anthropic',
      providerName: 'anthropic',
      configured: false,
      ok: false,
      error: 'Unsupported provider',
    })
  })

  it('passes a source\'s observed usage, awaiting state, and billing choice through unchanged', async () => {
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => undefined, readRecord: async () => undefined } as never)
    const controller = new QuotaController(ctx)
    const billing = {
      active: 'api' as const,
      switch: { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], apiKeyRef: 'ANTHROPIC_API_KEY', apiKeyStored: true },
    }
    controller.registerSource({
      id: 'anthropic', name: 'Anthropic (Claude)', configured: async () => true,
      fetch: async () => ({
        providerId: 'anthropic', providerName: 'Anthropic (Claude)', configured: true, ok: true,
        windows: { '5h': { usedPercent: 92, resetAt: 1_800_000_000_000 } }, asOf: 1_700_000_000_000, billing,
      }),
    })
    await expect(controller.listProviders()).resolves.toContainEqual({ id: 'anthropic', name: 'Anthropic (Claude)' })
    await expect(controller.fetch('anthropic')).resolves.toMatchObject({
      asOf: 1_700_000_000_000, billing: { active: 'api', switch: { apiKeyStored: true, apiKeyRef: 'ANTHROPIC_API_KEY' } },
      windows: { '5h': { usedPercent: 92 } },
    })
  })

  it('removes registered account sources when their owner disposes', async () => {
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => undefined, readRecord: async () => undefined } as never)
    const controller = new QuotaController(ctx)
    const source = { id: 'oauth-test', name: 'OAuth test', configured: async () => true,
      fetch: async () => ({ providerId: 'oauth-test', providerName: 'OAuth test', configured: true, ok: true }) }
    const remove = controller.registerSource(source)
    expect(() => controller.registerSource(source)).toThrow('already registered')
    await expect(controller.listProviders()).resolves.toContainEqual({ id: 'oauth-test', name: 'OAuth test' })
    await expect(controller.fetch('oauth-test')).resolves.toMatchObject({ ok: true })
    remove()
    remove()
    await expect(controller.listProviders()).resolves.toEqual(BUILT_IN)
    await expect(controller.fetch('oauth-test')).resolves.toMatchObject({ ok: false, error: 'Unsupported provider' })
  })
})
