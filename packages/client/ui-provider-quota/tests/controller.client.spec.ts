import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { QuotaBillingSwitch, QuotaProviderView, QuotaResult } from '@deepseek-ai/dsh-api-quota-controller/types'
import { ProviderQuotaController } from '../src/client/controller.ts'
import { localUsagePromptStore, OPEN_WINDOW_HOLD_MS, usagePrompt, type UsageSwitch } from '../src/client/usage-prompt.ts'

const provider = { id: 'fixture', name: 'Fixture' }
const value: QuotaResult = { providerId: provider.id, providerName: provider.name, configured: true, ok: true }
const failure = { ok: false as const, error: new RemoteError('gateway/internal', 'offline', {}) }
const billing: QuotaBillingSwitch = { settingsNs: 'llm', settingsPath: ['providers', 'anthropic'], apiKeyRef: 'ANTHROPIC_API_KEY', apiKeyStored: true }

function harness(stored?: UsageSwitch) {
  const listProviders = vi.fn<() => Promise<RemoteResult<readonly QuotaProviderView[]>>>(async () => ({ ok: true, value: [provider] }))
  const fetch = vi.fn<(id: string) => Promise<RemoteResult<QuotaResult>>>(async () => ({ ok: true, value }))
  const mutate = vi.fn(async () => ({ ok: true as const, value: {} }))
  const memory = {
    dismissed: (): readonly string[] => [],
    saveDismissed: vi.fn<(keys: readonly string[]) => void>(),
    switched: (): UsageSwitch | undefined => stored,
    saveSwitched: vi.fn<(next: UsageSwitch | undefined) => void>(),
  }
  const remote = { quota: { listProviders, fetch }, settings: { mutate } }
  return { controller: new ProviderQuotaController(remote, memory), listProviders, fetch, mutate, memory }
}

describe('provider quota client requests', () => {
  it('shares initial loading and refreshes discovery only on explicit refresh', async () => {
    const { controller, listProviders, fetch } = harness()
    const loading = controller.load()
    expect(controller.load()).toBe(loading)
    await loading
    expect(controller.providers.getSnapshot()).toEqual([provider])
    expect(controller.state.getSnapshot()).toEqual({ status: 'ready', results: [value] })
    await controller.refreshValues()
    expect(listProviders).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(2)
    await controller.refresh()
    expect(listProviders).toHaveBeenCalledTimes(2)
  })

  it('does not start another request while a quota fetch is pending', async () => {
    const { controller, fetch } = harness()
    let finish: ((result: RemoteResult<QuotaResult>) => void) | undefined
    fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = controller.load()
    await vi.waitFor(() => { expect(controller.state.getSnapshot().status).toBe('loading') })
    await controller.refreshValues()
    expect(fetch).toHaveBeenCalledOnce()
    if (finish === undefined) throw new Error('quota request did not start')
    finish({ ok: true, value })
    await pending
    expect(controller.state.getSnapshot().status).toBe('ready')
  })

  it('keeps the last results while values refresh', async () => {
    const { controller, fetch } = harness()
    await controller.load()
    let finish: ((result: RemoteResult<QuotaResult>) => void) | undefined
    fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = controller.refreshValues()
    expect(controller.state.getSnapshot()).toEqual({ status: 'loading', results: [value] })
    if (finish === undefined) throw new Error('quota request did not start')
    finish({ ok: true, value })
    await pending
    expect(controller.state.getSnapshot()).toEqual({ status: 'ready', results: [value] })
  })

  it('reports discovery errors and retries on refresh', async () => {
    const { controller, listProviders } = harness()
    listProviders.mockResolvedValueOnce(failure)
    await controller.load()
    expect(controller.providers.getSnapshot()).toEqual([])
    expect(controller.state.getSnapshot()).toEqual({ status: 'error', results: [], message: 'offline' })
    await controller.refresh()
    expect(controller.state.getSnapshot().status).toBe('ready')
  })

  it('reports total fetch failure while retaining successes from partial failure', async () => {
    const { controller, listProviders, fetch } = harness()
    fetch.mockResolvedValueOnce(failure)
    await controller.load()
    expect(controller.state.getSnapshot()).toEqual({ status: 'error', results: [], message: 'offline' })
    listProviders.mockResolvedValueOnce({ ok: true, value: [provider, { id: 'other', name: 'Other' }] })
    fetch.mockResolvedValueOnce(failure)
    await controller.refresh()
    expect(controller.state.getSnapshot()).toEqual({ status: 'ready', results: [value] })
  })

  it('handles refresh before discovery and an empty provider directory', async () => {
    const { controller, listProviders, fetch } = harness()
    await controller.refreshValues()
    expect(controller.state.getSnapshot()).toEqual({ status: 'ready', results: [] })
    expect(fetch).not.toHaveBeenCalled()
    listProviders.mockResolvedValueOnce({ ok: true, value: [] })
    await controller.load()
    expect(controller.providers.getSnapshot()).toEqual([])
    expect(controller.state.getSnapshot()).toEqual({ status: 'ready', results: [] })
  })

  it('writes API credits as a set op on the billing path and remembers the switch with its reset', async () => {
    const { controller, mutate, memory } = harness()
    await expect(controller.switchBilling(billing, 'api', 'anthropic', 1_700_000_000_000)).resolves.toBeUndefined()
    expect(mutate).toHaveBeenCalledWith('llm', [{ op: 'set', path: ['providers', 'anthropic', 'apiKeyEnv'], value: 'ANTHROPIC_API_KEY' }], undefined)
    expect(memory.saveSwitched).toHaveBeenCalledWith({ providerId: 'anthropic', resetAt: 1_700_000_000_000 })
    expect(controller.switched.getSnapshot()).toEqual({ providerId: 'anthropic', resetAt: 1_700_000_000_000 })
  })

  it('offers the switch back a day after a popover switch that names no reset, and keeps the offer across reload', async () => {
    const now = Date.UTC(2026, 9, 15, 12, 0)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    try {
      const data = new Map<string, string>()
      const storage = {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, text: string) => { data.set(key, text) },
        removeItem: (key: string) => { data.delete(key) },
      } as Storage
      const remote = {
        quota: { listProviders: async () => ({ ok: true as const, value: [provider] }), fetch: async () => ({ ok: true as const, value }) },
        settings: { mutate: vi.fn(async () => ({ ok: true as const, value: {} })) },
      }
      const controller = new ProviderQuotaController(remote, localUsagePromptStore(storage))
      await expect(controller.switchBilling(billing, 'api', 'anthropic')).resolves.toBeUndefined()
      expect(controller.switched.getSnapshot()).toEqual({ providerId: 'anthropic', resetAt: now + OPEN_WINDOW_HOLD_MS })
      const reloaded = new ProviderQuotaController(remote, localUsagePromptStore(storage)).switched.getSnapshot()!
      expect(reloaded).toEqual({ providerId: 'anthropic', resetAt: now + OPEN_WINDOW_HOLD_MS })
      const apiResult: QuotaResult = { providerId: 'anthropic', providerName: 'Anthropic', configured: true, ok: true, billing: { active: 'api', switch: billing } }
      expect(usagePrompt([apiResult], { dismissed: new Set(), switched: reloaded, now: now + OPEN_WINDOW_HOLD_MS - 1 })).toBeUndefined()
      expect(usagePrompt([apiResult], { dismissed: new Set(), switched: reloaded, now: now + OPEN_WINDOW_HOLD_MS })).toMatchObject({ kind: 'switch-back' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('completes a switch and a dismissal after the remote write when browser storage throws', async () => {
    const failing = () => { throw new Error('quota exceeded') }
    const partial: Partial<Storage> = { getItem: failing, setItem: failing, removeItem: failing }
    const memory = localUsagePromptStore(partial as Storage)
    const mutate = vi.fn(async () => ({ ok: true as const, value: {} }))
    const remote = { quota: { listProviders: async () => ({ ok: true as const, value: [provider] }), fetch: async () => ({ ok: true as const, value }) }, settings: { mutate } }
    const controller = new ProviderQuotaController(remote, memory)
    await expect(controller.switchBilling(billing, 'api', 'anthropic', 7)).resolves.toBeUndefined()
    expect(controller.switched.getSnapshot()).toEqual({ providerId: 'anthropic', resetAt: 7 })
    expect(controller.state.getSnapshot()).toEqual({ status: 'ready', results: [value] })
    expect(() => { controller.dismiss('limit|a|5h|1') }).not.toThrow()
    expect(controller.dismissed.getSnapshot()).toEqual(['limit|a|5h|1'])
  })

  it('switches back to the subscription by unsetting the key and clears the switch', async () => {
    const { controller, mutate, memory } = harness({ providerId: 'anthropic', resetAt: 1 })
    await expect(controller.switchBilling(billing, 'subscription', 'anthropic')).resolves.toBeUndefined()
    expect(mutate).toHaveBeenCalledWith('llm', [{ op: 'unset', path: ['providers', 'anthropic', 'apiKeyEnv'] }], undefined)
    expect(memory.saveSwitched).toHaveBeenCalledWith(undefined)
    expect(controller.switched.getSnapshot()).toBeUndefined()
  })

  it('reports a refused settings write and keeps the prior switch', async () => {
    const { controller, mutate, memory } = harness()
    mutate.mockResolvedValueOnce({ ok: false, error: new RemoteError('settings/conflict', 'changed elsewhere', { ns: 'llm', expected: 1, actual: 2 }) } as never)
    await expect(controller.switchBilling(billing, 'api', 'anthropic')).resolves.toBe('changed elsewhere')
    expect(memory.saveSwitched).not.toHaveBeenCalled()
    expect(controller.switched.getSnapshot()).toBeUndefined()
  })

  it('ends the switch-back offer when the user declines it', () => {
    const { controller, memory } = harness({ providerId: 'anthropic', resetAt: 1 })
    controller.dismiss('back|anthropic|1')
    expect(memory.saveSwitched).toHaveBeenCalledWith(undefined)
    expect(memory.saveDismissed).not.toHaveBeenCalled()
    expect(controller.switched.getSnapshot()).toBeUndefined()
  })

  it('remembers a dismissed prompt key in the store and the snapshot', () => {
    const { controller, memory } = harness()
    const key = `limit|anthropic|monthly|${Date.now() + 60_000}`
    controller.dismiss(key)
    expect(memory.saveDismissed).toHaveBeenCalledWith([key])
    expect(controller.dismissed.getSnapshot()).toEqual([key])
  })
})

describe('provider quota overlapping loads', () => {
  const listing = (...ids: string[]): RemoteResult<readonly QuotaProviderView[]> => ({ ok: true, value: ids.map(id => ({ id, name: id })) })
  const resultFor = (id: string, tag: string): QuotaResult => ({ providerId: id, providerName: id, configured: true, ok: true, windows: { credits: { usedPercent: null, resetAt: null, valueLabel: tag } } })

  it('ignores an older provider list that arrives after a newer refresh', async () => {
    const { controller, listProviders, fetch } = harness()
    const older = Promise.withResolvers<RemoteResult<readonly QuotaProviderView[]>>()
    listProviders.mockReturnValueOnce(older.promise)
    fetch.mockImplementation(async id => ({ ok: true, value: resultFor(id, 'v') }))
    const first = controller.load()
    listProviders.mockResolvedValueOnce(listing('new'))
    await controller.refresh()
    older.resolve(listing('removed'))
    await first

    expect(controller.providers.getSnapshot()).toEqual([{ id: 'new', name: 'new' }])
    expect(controller.state.getSnapshot().results.map(result => result.providerId)).toEqual(['new'])
    expect(fetch).not.toHaveBeenCalledWith('removed')
  })

  it('ignores older quota results that arrive after a newer refresh', async () => {
    const { controller, fetch } = harness()
    const older = Promise.withResolvers<RemoteResult<QuotaResult>>()
    fetch.mockReturnValueOnce(older.promise)
    const first = controller.load()
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledOnce() })
    fetch.mockResolvedValueOnce({ ok: true, value: resultFor('fixture', 'new') })
    await controller.refresh()
    older.resolve({ ok: true, value: resultFor('fixture', 'old') })
    await first

    expect(controller.state.getSnapshot()).toEqual({ status: 'ready', results: [resultFor('fixture', 'new')] })
  })

  it('publishes completed providers when one call never settles', async () => {
    const remote = {
      quota: {
        listProviders: async () => listing('stuck', 'done'),
        fetch: (id: string) => id === 'stuck' ? new Promise<RemoteResult<QuotaResult>>(() => undefined) : Promise.resolve({ ok: true as const, value: resultFor(id, 'v') }),
      },
      settings: { mutate: async () => ({ ok: true as const, value: {} }) },
    }
    const memory = { dismissed: (): readonly string[] => [], saveDismissed: vi.fn(), switched: (): undefined => undefined, saveSwitched: vi.fn() }
    const controller = new ProviderQuotaController(remote, memory, 20)
    await controller.load()

    expect(controller.state.getSnapshot()).toEqual({
      status: 'ready',
      results: [
        { providerId: 'stuck', providerName: 'stuck', configured: true, ok: false, error: 'Quota request timed out' },
        resultFor('done', 'v'),
      ],
    })
  })
})
