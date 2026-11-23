import { Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import { QuotaController, type QuotaResult, type QuotaSource } from '../src/index.ts'

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

const never = <T>(): Promise<T> => new Promise<T>(() => undefined)
const okResult = (id: string, name = id, tag?: string): QuotaResult => ({ providerId: id, providerName: name, configured: true, ok: true, ...tag === undefined ? {} : { windows: { credits: { usedPercent: null, resetAt: null, valueLabel: tag } } } })

function hostCtx(resolve: (ref: CredentialRef) => Promise<unknown> = async () => undefined): Context {
  const ctx = new Context()
  ctx.provide('credentials', { resolve, readRecord: async () => undefined } as never)
  return ctx
}

describe('QuotaController bounded reads', () => {
  it('bounds a stuck custom source and serves a retry after the deadline', async () => {
    const controller = new QuotaController(hostCtx(), { timeoutMs: 20 })
    const fetchSource = vi.fn<() => Promise<QuotaResult>>().mockImplementationOnce(() => never()).mockResolvedValue(okResult('slow', 'Slow'))
    controller.registerSource({ id: 'slow', name: 'Slow', configured: async () => true, fetch: fetchSource })

    await expect(controller.fetch('slow')).resolves.toMatchObject({ providerId: 'slow', ok: false, error: 'Quota request timed out' })
    await expect(controller.fetch('slow')).resolves.toMatchObject({ ok: true })
    expect(fetchSource).toHaveBeenCalledTimes(2)
  })

  it('bounds a stuck credential lookup and serves a retry after the deadline', async () => {
    const resolve = vi.fn<(ref: CredentialRef) => Promise<unknown>>().mockImplementationOnce(() => never()).mockImplementation(async ref => ref === 'DEEPSEEK_API_KEY' ? { value: 'key', source: 'test' } : undefined)
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ balance_infos: [{ currency: 'USD', total_balance: '1' }] }))
    const controller = new QuotaController(hostCtx(resolve), { fetch: fetcher, timeoutMs: 20 })

    await expect(controller.fetch('deepseek-official')).resolves.toMatchObject({ ok: false, error: 'Quota request timed out' })
    await expect(controller.fetch('deepseek-official')).resolves.toMatchObject({ ok: true })
  })

  it('aborts the request signal handed to a source when the deadline passes', async () => {
    let seen: AbortSignal | null | undefined
    const fetcher = vi.fn<typeof fetch>((_input, init) => { seen = init?.signal; return never() })
    const controller = new QuotaController(hostCtx(async () => ({ value: 'key', source: 'test' })), { fetch: fetcher, timeoutMs: 20 })

    await expect(controller.fetch('deepseek-official')).resolves.toMatchObject({ error: 'Quota request timed out' })
    expect(seen?.aborted).toBe(true)
  })
})

describe('QuotaController source replacement', () => {
  const stubSource = (fetchSource: () => Promise<QuotaResult>): QuotaSource => ({ id: 'claude', name: 'Claude', configured: async () => true, fetch: fetchSource })

  it('does not hand a replaced source\'s pending read to the new source', async () => {
    const controller = new QuotaController(hostCtx())
    const old = Promise.withResolvers<QuotaResult>()
    const removeOld = controller.registerSource(stubSource(() => old.promise))
    const first = controller.fetch('claude')
    removeOld()
    controller.registerSource(stubSource(async () => okResult('claude', 'Claude', 'new')))

    await expect(controller.fetch('claude')).resolves.toMatchObject({ windows: { credits: { valueLabel: 'new' } } })
    await expect(first).resolves.toMatchObject({ ok: false, error: 'Quota source changed' })
    old.resolve(okResult('claude', 'Claude', 'old'))
  })

  it('answers a removed source as unsupported while its first read is still pending', async () => {
    const controller = new QuotaController(hostCtx())
    const removeOld = controller.registerSource(stubSource(() => never()))
    void controller.fetch('claude')
    removeOld()

    await expect(controller.fetch('claude')).resolves.toMatchObject({ ok: false, error: 'Unsupported provider' })
  })

  it('keeps the replacement\'s pending read when the old read settles late', async () => {
    const controller = new QuotaController(hostCtx())
    const old = Promise.withResolvers<QuotaResult>()
    const next = Promise.withResolvers<QuotaResult>()
    const fetchNew = vi.fn(() => next.promise)
    const removeOld = controller.registerSource(stubSource(() => old.promise))
    void controller.fetch('claude')
    removeOld()
    controller.registerSource(stubSource(fetchNew))
    const second = controller.fetch('claude')
    old.resolve(okResult('claude', 'Claude', 'old'))
    await Promise.resolve()

    expect(controller.fetch('claude')).toBe(second)
    expect(fetchNew).toHaveBeenCalledOnce()
    next.resolve(okResult('claude', 'Claude', 'new'))
    await expect(second).resolves.toMatchObject({ windows: { credits: { valueLabel: 'new' } } })
  })

  it.each([
    ['reference', 'credentials/reference-updated', 'OPENCODE_GO_API_KEY'],
    ['record', 'credentials/record-updated', 'llm-pi-ai/opencode-go'],
  ] as const)('cancels a pending built-in read when its credential %s changes', async (_name, event, subject) => {
    const ctx = hostCtx(() => never())
    const controller = new QuotaController(ctx)
    const pending = controller.fetch('opencode-go')
    ctx.emit(event as 'credentials/record-updated', subject as never)

    await expect(pending).resolves.toMatchObject({ ok: false, error: 'Quota credential changed' })
  })
})
