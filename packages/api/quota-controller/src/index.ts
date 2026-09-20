/** Host Remote owner for credential-backed provider quota usage. */

import { Context } from '@deepseek-ai/cordis'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createQuotaProviderRegistry, type QuotaProvider } from './providers.ts'
import type { QuotaProviderView, QuotaResult } from './types.ts'

export type * from './types.ts'
export { createQuotaProviderRegistry } from './providers.ts'
export type { QuotaProvider } from './providers.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { quotaController: QuotaController }
}

export interface QuotaControllerInternals {
  readonly fetch?: typeof fetch
  readonly providers?: readonly QuotaProvider[]
}

/** requires credential-backed provider quota Remote service. */
export class QuotaController extends TypertRemoteService {
  private readonly providers: ReadonlyMap<string, QuotaProvider>
  private readonly fetchImpl: typeof fetch
  private readonly pending = new Map<string, Promise<QuotaResult>>()

  constructor(ctx: Context, internals: QuotaControllerInternals = {}) {
    super(ctx, 'quotaController', { namespace: 'quota' })
    this.providers = createQuotaProviderRegistry(internals.providers)
    this.fetchImpl = internals.fetch ?? fetch
  }

  @Remote
  /** requires @returns configured providers with available credentials. */
  async listProviders(): Promise<readonly QuotaProviderView[]> {
    const configured = await Promise.all([...this.providers.values()].map(async (provider) => {
      const value = await this.resolveCredential(provider)
      return value === undefined ? undefined : { id: provider.id, name: provider.name }
    }))
    return configured.filter((provider): provider is QuotaProviderView => provider !== undefined)
  }

  @Remote
  /** requires @param providerId - provider identifier. @returns the provider quota result. */
  fetch(providerId: string): Promise<QuotaResult> {
    const existing = this.pending.get(providerId)
    if (existing !== undefined) return existing
    const provider = this.providers.get(providerId)
    const operation = provider === undefined
      ? Promise.resolve({ providerId, providerName: providerId, configured: false, ok: false, error: 'Unsupported provider' })
      : this.fetchProvider(provider)
    this.pending.set(providerId, operation)
    void operation.finally(() => {
      if (this.pending.get(providerId) === operation) this.pending.delete(providerId)
    })
    return operation
  }

  private async fetchProvider(provider: QuotaProvider): Promise<QuotaResult> {
    const credential = await this.resolveCredential(provider)
    if (credential === undefined) return { providerId: provider.id, providerName: provider.name, configured: false, ok: false, error: 'Not configured' }
    return provider.fetch(credential, this.fetchImpl)
  }

  private async resolveCredential(provider: QuotaProvider): Promise<import('@deepseek-ai/dsh-credentials').ResolvedCredential | undefined> {
    for (const ref of provider.credentialRefs ?? [provider.credentialRef]) {
      const value = await this.credentials().resolve(ref)
      if (value !== undefined) return value
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
