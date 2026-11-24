/** Host Remote owner for credential-backed provider quota usage. */

import { Context, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createQuotaProviderRegistry, type QuotaProvider, type QuotaSource } from './providers.ts'
import type { QuotaProviderView, QuotaResult } from './types.ts'

export type * from './types.ts'
export { createQuotaProviderRegistry } from './providers.ts'
export type { QuotaProvider, QuotaSource } from './providers.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { quotaController: QuotaController }
}

/** Injectable Host dependencies used by quota controller tests and deployments. */
export interface QuotaControllerInternals {
  /** Fetch implementation used for provider quota requests. */
  readonly fetch?: typeof fetch
  /** Additional or replacement provider definitions available to the controller. */
  readonly providers?: readonly QuotaProvider[]
  /** Whole-percent share of a subscription window at which the composer warns; the loader supplies it from the namespace. */
  readonly nearLimitPercent?: Volatile<number>
  readonly timeoutMs?: number
}

interface Pending {
  readonly target: QuotaSource | QuotaProvider
  readonly result: Promise<QuotaResult>
  readonly cancel: (error: string) => void
}

/** requires credential-backed provider quota Remote service. */
export class QuotaController extends TypertRemoteService {
  static Config = z.object({
    nearLimitPercent: z.number().step(1).min(50).max(100).default(90).volatile(),
  })
  private readonly providers: ReadonlyMap<string, QuotaProvider>
  private readonly fetchImpl: typeof fetch
  private readonly sources = new Map<string, QuotaSource>()
  private readonly pending = new Map<string, Pending>()
  private readonly timeoutMs: number

  constructor(ctx: Context, internals: QuotaControllerInternals = {}) {
    super(ctx, 'quotaController', { namespace: 'quota' })
    this.providers = createQuotaProviderRegistry(internals.providers)
    this.fetchImpl = internals.fetch ?? fetch
    this.timeoutMs = internals.timeoutMs ?? 30_000
    ctx.on('credentials/reference-updated', (ref) => {
      this.cancelForCredential(provider => (provider.credentialRefs ?? [provider.credentialRef]).includes(ref))
    })
    ctx.on('credentials/record-updated', (key) => {
      this.cancelForCredential(provider => provider.credentialKey === key)
    })
  }

  /**
   * Register an account source whose provider owns authentication.
   * @param source - provider-owned source.
   * @returns disposer that removes this source.
   */
  registerSource(source: QuotaSource): () => void {
    if (this.providers.has(source.id) || this.sources.has(source.id)) throw new Error(`Quota source already registered: ${source.id}`)
    this.sources.set(source.id, source)
    return () => {
      if (this.sources.get(source.id) !== source) return
      this.sources.delete(source.id)
      const entry = this.pending.get(source.id)
      if (entry?.target === source) entry.cancel('Quota source changed')
    }
  }

  /**
   * List every provider the popover reports on, set up or not; `fetch` says which are configured.
   * Connected model routes without a usage source are not listed.
   * @returns built-in providers, then registered sources.
   */
  @Remote
  listProviders(): Promise<readonly QuotaProviderView[]> {
    return Promise.resolve([...this.providers.values(), ...this.sources.values()].map(({ id, name }) => ({ id, name })))
  }

  /**
   * Fetch quota state for one provider, coalescing concurrent requests.
   * @param providerId - provider identifier.
   * @returns the provider quota result.
   */
  @Remote
  fetch(providerId: string): Promise<QuotaResult> {
    const provider = this.providers.get(providerId)
    const source = this.sources.get(providerId)
    const target = source ?? provider
    if (target === undefined) {
      return Promise.resolve({ providerId, providerName: providerId, configured: false, ok: false, error: 'Unsupported provider' })
    }
    const existing = this.pending.get(providerId)
    if (existing?.target === target) return existing.result
    return this.start(providerId, target, source !== undefined
      ? fetchImpl => source.fetch(fetchImpl)
      : fetchImpl => this.fetchProvider(provider as QuotaProvider, fetchImpl))
  }

  private start(id: string, target: QuotaSource | QuotaProvider, execute: (fetchImpl: typeof fetch) => Promise<QuotaResult>): Promise<QuotaResult> {
    const abort = new AbortController()
    const unavailable = (error: string): QuotaResult => ({ providerId: id, providerName: target.name, configured: true, ok: false, error })
    let cancel = (_error: string): void => undefined
    const result = new Promise<QuotaResult>((resolve, reject) => {
      const timer = setTimeout(() => { cancel('Quota request timed out') }, this.timeoutMs)
      timer.unref()
      cancel = (error) => {
        clearTimeout(timer)
        abort.abort()
        resolve(unavailable(error))
      }
      new Promise<QuotaResult>(run => { run(execute(this.bindSignal(abort.signal))) }).then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error: unknown) => { clearTimeout(timer); reject(error) },
      )
    })
    const entry: Pending = { target, result, cancel: error => { cancel(error) } }
    this.pending.set(id, entry)
    const release = (): void => { if (this.pending.get(id) === entry) this.pending.delete(id) }
    void result.then(release, release)
    return result
  }

  private bindSignal(signal: AbortSignal): typeof fetch {
    return (input, init) => this.fetchImpl(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal })
  }

  private cancelForCredential(match: (provider: QuotaProvider) => boolean): void {
    for (const provider of this.providers.values()) {
      const entry = this.pending.get(provider.id)
      if (entry?.target === provider && match(provider)) entry.cancel('Quota credential changed')
    }
  }

  private async fetchProvider(provider: QuotaProvider, fetchImpl: typeof fetch): Promise<QuotaResult> {
    const credential = await this.resolveCredential(provider)
    if (credential === undefined) return { providerId: provider.id, providerName: provider.name, configured: false, ok: false, error: `Set up ${provider.name} in Settings > Models` }
    return provider.fetch(credential, fetchImpl)
  }

  private async resolveCredential(provider: QuotaProvider): Promise<import('@deepseek-ai/dsh-credentials').ResolvedCredential | undefined> {
    for (const ref of provider.credentialRefs ?? [provider.credentialRef]) {
      const value = await this.credentials().resolve(ref)
      if (value !== undefined) return value
    }
    const key = provider.credentialKey
    if (key !== undefined) {
      const record = await this.credentials().readRecord(key)
      if (record?.kind === 'api-key' && record.key !== undefined && record.key.length > 0) {
        return { value: record.key, source: `record:${key}` }
      }
    }
    return undefined
  }

  private credentials(): CredentialProvider {
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) throw new RemoteError('gateway/internal', 'credentials service is absent', {})
    return credentials
  }
}

export default QuotaController
