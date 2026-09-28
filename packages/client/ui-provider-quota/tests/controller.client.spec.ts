import { describe, expect, it, vi } from 'vitest'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { QuotaProviderView, QuotaResult } from '@deepseek-ai/dsh-api-quota-controller/types'
import { ProviderQuotaController } from '../src/client/controller.ts'

const provider = { id: 'fixture', name: 'Fixture' }
const value: QuotaResult = { providerId: provider.id, providerName: provider.name, configured: true, ok: true }
const failure = { ok: false as const, error: new RemoteError('gateway/internal', 'offline', {}) }

function harness() {
  const listProviders = vi.fn<() => Promise<RemoteResult<readonly QuotaProviderView[]>>>(async () => ({ ok: true, value: [provider] }))
  const fetch = vi.fn<(id: string) => Promise<RemoteResult<QuotaResult>>>(async () => ({ ok: true, value }))
  const remote: Pick<ClientRemote, 'quota'> = { quota: { listProviders, fetch } }
  return { controller: new ProviderQuotaController(remote), listProviders, fetch }
}

describe('provider quota client requests', () => {
  it('shares initial loading and refreshes discovery only on explicit refresh', async () => {
    const { controller, listProviders, fetch } = harness()
    const loading = controller.load()
    expect(controller.load()).toBe(loading)
    await loading
    expect(controller.providers.getSnapshot()).toEqual([provider])
    expect(controller.state.getSnapshot()).toEqual({ status: 'ready', results: [value] })
    await controller.refreshIfOpen()
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
    await controller.refreshIfOpen()
    expect(fetch).toHaveBeenCalledOnce()
    if (finish === undefined) throw new Error('quota request did not start')
    finish({ ok: true, value })
    await pending
    expect(controller.state.getSnapshot().status).toBe('ready')
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
    await controller.refreshIfOpen()
    expect(controller.state.getSnapshot()).toEqual({ status: 'ready', results: [] })
    expect(fetch).not.toHaveBeenCalled()
    listProviders.mockResolvedValueOnce({ ok: true, value: [] })
    await controller.load()
    expect(controller.providers.getSnapshot()).toEqual([])
    expect(controller.state.getSnapshot()).toEqual({ status: 'ready', results: [] })
  })
})
