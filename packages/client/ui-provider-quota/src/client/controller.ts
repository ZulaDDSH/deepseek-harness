/** Client state and Remote calls for provider quota usage. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { QuotaBillingSwitch, QuotaProviderView, QuotaResult } from '@deepseek-ai/dsh-api-quota-controller/types'
import { localUsagePromptStore, withDismissed, type UsagePromptStore, type UsageSwitch } from './usage-prompt.ts'

/** Observable client state for the provider quota popover. */
export interface QuotaState {
  /** Current provider-quota request phase. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  /** Successful provider quota results. */
  readonly results: readonly QuotaResult[]
  /** Failure message when the controller cannot load quota state. */
  readonly message?: string
}

/** Owns quota-provider discovery, refresh, billing switches, and observable client state. */
export class ProviderQuotaController {
  /** Providers the popover reports on, or null before first load. */
  readonly providers: SnapshotStore<readonly QuotaProviderView[] | null> = createSnapshotStore(null)
  /** Current quota request state rendered by the popover. */
  readonly state: SnapshotStore<QuotaState> = createSnapshotStore({ status: 'idle', results: [] })
  /** Usage prompt keys the user dismissed. */
  readonly dismissed: SnapshotStore<readonly string[]>
  /** The last switch to API credits, offered back once its window resets. */
  readonly switched: SnapshotStore<UsageSwitch | undefined>
  private loading: Promise<void> | undefined

  constructor(
    private readonly remote: Pick<ClientRemote, 'quota'> & {
      readonly settings: {
        mutate(
          ns: string,
          ops: SettingsPathOpView[],
          expectedRevision: number | undefined,
        ): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: { readonly message: string } }>
      }
    },
    private readonly memory: UsagePromptStore = localUsagePromptStore(),
  ) {
    this.dismissed = createSnapshotStore(memory.dismissed())
    this.switched = createSnapshotStore(memory.switched())
  }

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

  /** Refresh quota values without reloading provider identities; skipped while a request is pending. */
  async refreshValues(): Promise<void> {
    if (this.state.getSnapshot().status === 'loading') return
    await this.fetchConfigured()
  }

  /**
   * Remember that a prompt was dismissed until its window resets; declining the offer to switch back ends it.
   * @param key - the prompt key.
   */
  dismiss(key: string): void {
    if (key.startsWith('back|')) {
      this.memory.saveSwitched(undefined)
      this.switched.set(undefined)
      return
    }
    const next = withDismissed(this.dismissed.getSnapshot(), key, Date.now())
    this.memory.saveDismissed(next)
    this.dismissed.set(next)
  }

  /**
   * Flip a provider's billing choice through the settings write path, then reload usage.
   * @param billing - the switch the quota result offers.
   * @param target - API credits, or the subscription sign-in.
   * @param providerId - provider whose billing changes.
   * @param resetAt - reset instant of the window the switch answers, when known.
   * @returns the refusal message, or undefined once written.
   */
  async switchBilling(
    billing: QuotaBillingSwitch,
    target: 'api' | 'subscription',
    providerId: string,
    resetAt?: number,
  ): Promise<string | undefined> {
    const path = [...billing.settingsPath, 'apiKeyEnv']
    const ops: SettingsPathOpView[] = target === 'api'
      ? [{ op: 'set', path, value: billing.apiKeyRef }]
      : [{ op: 'unset', path }]
    const response = await this.remote.settings.mutate(billing.settingsNs, ops, undefined)
    if (!response.ok) return response.error.message
    const switched: UsageSwitch | undefined = target === 'api' ? { providerId, ...resetAt === undefined ? {} : { resetAt } } : undefined
    this.memory.saveSwitched(switched)
    this.switched.set(switched)
    await this.refresh()
    return undefined
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
    this.state.set({ status: 'loading', results: this.state.getSnapshot().results })
    const providers = this.providers.getSnapshot() ?? []
    const responses = await Promise.all(providers.map(provider => this.remote.quota.fetch(provider.id)))
    const failures = responses.filter(response => !response.ok)
    const failure = failures[0]
    if (failures.length === responses.length && failure !== undefined) {
      this.state.set({ status: 'error', results: [], message: failure.error.message })
      return
    }
    this.state.set({ status: 'ready', results: responses.flatMap(response => response.ok ? [response.value] : []) })
  }
}
