/** Client state and Remote calls for provider quota usage. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { QuotaProviderView, QuotaResult } from '@deepseek-ai/dsh-api-quota-controller/types'

export interface QuotaState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly results: readonly QuotaResult[]
  readonly message?: string
}

export class ProviderQuotaController {
  readonly providers: SnapshotStore<readonly QuotaProviderView[] | null> = createSnapshotStore(null)
  readonly state: SnapshotStore<QuotaState> = createSnapshotStore({ status: 'idle', results: [] })
  private loading: Promise<void> | undefined

  constructor(private readonly remote: Pick<ClientRemote, 'quota'>) {}

  load(): Promise<void> {
    this.loading ??= this.loadProviders()
    return this.loading
  }

  refresh(): Promise<void> {
    this.loading = this.loadProviders()
    return this.loading
  }

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
      const firstFailure = failures[0]
      this.state.set({ status: 'error', results: [], message: firstFailure !== undefined && !firstFailure.ok ? firstFailure.error.message : 'Request failed' })
      return
    }
    this.state.set({ status: 'ready', results: responses.flatMap(response => response.ok ? [response.value] : []) })
  }
}
