import { createHash, randomBytes } from 'node:crypto'
import {
  auth, extractWWWAuthenticateParams, OAuthError, SdkErrorCode, SdkHttpError, UnauthorizedError,
  type AuthProvider, type OAuthClientMetadata, type OAuthClientProvider,
  type StoredOAuthClientInformation, type StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { StreamableHttpConfig } from './index.ts'

export const GRANT_SCOPE = 'mcp-client'

const CLIENT_NAME = 'DeepSeek Harness'

const PLACEHOLDER_REDIRECT = 'http://127.0.0.1/callback'

export interface McpGrant {
  url: string
  tokens?: StoredOAuthTokens
  clientInformation?: StoredOAuthClientInformation
}

export interface GrantStore {
  read(): Promise<McpGrant | undefined>
  update(patch: Partial<McpGrant>): Promise<void>
}

export class AuthRequiredError extends Error {
  constructor(serverName: string) {
    super(`${serverName} requires sign-in`)
    this.name = 'AuthRequiredError'
  }
}

export function grantKey(serverName: string): CredentialKey {
  const slug = serverName.toLowerCase().replaceAll('_', '-')
  const digest = createHash('sha256').update(serverName).digest('hex').slice(0, 8)
  return credentialKey(GRANT_SCOPE, `srv-${slug}-${digest}`)
}

export function hasAuthorizationHeader(config: Pick<StreamableHttpConfig, 'headers' | 'headerEnv'>): boolean {
  return [...Object.keys(config.headers), ...Object.keys(config.headerEnv ?? {})]
    .some(name => name.toLowerCase() === 'authorization')
}

export function isAuthRequired(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current instanceof AuthRequiredError || current instanceof UnauthorizedError) return true
    if (current instanceof SdkHttpError && current.code === SdkErrorCode.ClientHttpAuthentication) return true
    if (/HTTP 401/.test(current.message)) return true
    current = current.cause
  }
  return false
}

function isGrant(value: unknown, url: string): value is McpGrant {
  return typeof value === 'object' && value !== null && (value as { url?: unknown }).url === url
}

export function memoryGrantStore(url: string): GrantStore {
  let grant: McpGrant = { url }
  return {
    read: () => Promise.resolve(grant),
    update: (patch) => {
      grant = { ...grant, ...patch }
      return Promise.resolve()
    },
  }
}

export function recordGrantStore(ctx: Context, key: CredentialKey, url: string): GrantStore {
  const read = async (): Promise<McpGrant | undefined> => {
    const record = await ctx.get('credentials')?.readRecord(key)
    return record?.kind === 'grant' && isGrant(record.payload, url) ? record.payload : undefined
  }
  return {
    read,
    update: async (patch) => {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) throw new Error('no credentials service is mounted to store the sign-in')
      await credentials.modifyRecord(key, (current) => {
        const stored = current?.kind === 'grant' && isGrant(current.payload, url) ? current.payload : { url }
        return Promise.resolve({ kind: 'grant', payload: { ...stored, ...patch } })
      })
    },
  }
}

export class GrantProvider implements OAuthClientProvider {
  expectedState = ''
  private verifier = ''

  constructor(
    private readonly store: GrantStore,
    private readonly redirect: string,
    private readonly onRedirect: (url: URL) => void,
  ) {}

  get redirectUrl(): string {
    return this.redirect
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: CLIENT_NAME,
      redirect_uris: [this.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  state(): string {
    this.expectedState = randomBytes(16).toString('base64url')
    return this.expectedState
  }

  async clientInformation(): Promise<StoredOAuthClientInformation | undefined> {
    return (await this.store.read())?.clientInformation
  }

  saveClientInformation(clientInformation: StoredOAuthClientInformation): Promise<void> {
    return this.store.update({ clientInformation })
  }

  async tokens(): Promise<StoredOAuthTokens | undefined> {
    return (await this.store.read())?.tokens
  }

  saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    return this.store.update({ tokens })
  }

  redirectToAuthorization(url: URL): void {
    this.onRedirect(url)
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier
  }

  codeVerifier(): string {
    return this.verifier
  }
}

export function grantAuthProvider(serverName: string, store: GrantStore): AuthProvider {
  const provider = new GrantProvider(store, PLACEHOLDER_REDIRECT, () => { throw new AuthRequiredError(serverName) })
  return {
    token: async () => (await provider.tokens())?.access_token,
    onUnauthorized: async ({ response, serverUrl, fetchFn }) => {
      const grant = await store.read()
      if (grant?.tokens?.refresh_token === undefined || grant.clientInformation === undefined) {
        throw new AuthRequiredError(serverName)
      }
      const { resourceMetadataUrl } = extractWWWAuthenticateParams(response)
      try {
        await auth(provider, { serverUrl, fetchFn, ...resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl } })
      } catch (error) {
        throw error instanceof OAuthError && error.code === 'invalid_grant'
          ? new AuthRequiredError(serverName)
          : error
      }
    },
  }
}
