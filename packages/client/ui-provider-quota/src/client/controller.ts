/** Client state and Remote calls for provider quota usage. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { QuotaProviderView, QuotaResult } from '@deepseek-ai/dsh-api-quota-controller/types'

/** Observable client state for the provider quota popover. */
export interface QuotaState {
  /** Current provider-quota request phase. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  /** Successful provider quota results. */
  readonly results: readonly QuotaResult[]
  /** Failure message when the controller cannot load quota state. */
  readonly message?: string
}

/** Owns quota-provider discovery, refresh, and observable client state. */
export class ProviderQuotaController {
  /** Configured providers returned by the Host, or null before first load. */
  readonly providers: SnapshotStore<readonly QuotaProviderView[] | null> = createSnapshotStore(null)
  /** Current quota request state rendered by the popover. */
  readonly state: SnapshotStore<QuotaState> = createSnapshotStore({ status: 'idle', results: [] })
  private loading: Promise<void> | undefined

  constructor(private readonly remote: Pick<ClientRemote, 'quota'>) {}

  /** Load provider identities once and then fetch their quota state. */
  load(): Promise<void> {
    this.loading ??= this.loadProviders()
    return this.loading
  }

  /** Force provider discovery and quota state to reload. */
  refresh(): Promise<void> {
    this.loading = this.loadProviders()
    return this.loading
  }

  /** Refresh quota values without reloading provider identities when the surface is open. */
  async refreshIfOpen(): Promise<void> {
    if (this.state.getSnapshot().status === 'loading') return
    this.state.set({ status: 'loading', results: [] })
    await this.fetchConfigured()
  }

  private async loadProviders(): Promise<void> {
    const response = await this.remote.quota.listProviders()
    if (!response.ok) {
      this.providers.set([])
      this.state.set({ status: 'error', results: [], message: response.error.message })
      return
    }
    this.providers.set(response.value)
    await this.fetchConfigured()
  }

  private async fetchConfigured(): Promise<void> {
    this.state.set({ status: 'loading', results: [] })
    const providers = this.providers.getSnapshot() ?? []
    const responses = await Promise.all(providers.map(provider => this.remote.quota.fetch(provider.id)))
    const failures = responses.filter(response => !response.ok)
    if (failures.length === responses.length && failures.length > 0) {
      this.state.set({ status: 'error', results: [], message: failures.at(0)?.error.message ?? 'Request failed' })
      return
    }
    this.state.set({ status: 'ready', results: responses.flatMap(response => response.ok ? [response.value] : []) })
  }
}
