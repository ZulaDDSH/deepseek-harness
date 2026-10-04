import { createHash, randomBytes } from 'node:crypto'
import {
  auth, extractWWWAuthenticateParams, InsufficientScopeError, OAuthError, SdkErrorCode, SdkHttpError, UnauthorizedError,
  type AuthProvider, type OAuthClientMetadata, type OAuthClientProvider,
  type StoredOAuthClientInformation, type StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { StreamableHttpConfig } from './index.ts'

/** Credential scope that holds the OAuth grants of MCP servers. */
export const GRANT_SCOPE = 'mcp-client'

const CLIENT_NAME = 'DeepSeek Harness'

const PLACEHOLDER_REDIRECT = 'http://127.0.0.1/callback'

/** The OAuth state stored for one MCP server URL: its tokens and dynamic client registration. */
export interface McpGrant {
  url: string
  tokens?: StoredOAuthTokens
  clientInformation?: StoredOAuthClientInformation
}

/** Where a grant is read from and written to during sign-in and refresh. */
export interface GrantStore {
  read(): Promise<McpGrant | undefined>
  update(patch: Partial<McpGrant>): Promise<void>
}

/** The server needs the user to sign in; no stored grant can authorize the request. */
export class AuthRequiredError extends Error {
  /** @param serverName Server named in the message the model reads. */
  constructor(serverName: string) {
    super(`${serverName} requires sign-in`)
    this.name = 'AuthRequiredError'
  }
}

/**
 * Credential key of a server's grant, unique per server name.
 * @param serverName Configured MCP server name.
 * @returns The key in the MCP grant scope.
 */
export function grantKey(serverName: string): CredentialKey {
  const slug = serverName.toLowerCase().replaceAll('_', '-')
  const digest = createHash('sha256').update(serverName).digest('hex').slice(0, 8)
  return credentialKey(GRANT_SCOPE, `srv-${slug}-${digest}`)
}

/**
 * Whether the configuration sends its own Authorization header, which turns OAuth off.
 * @param config Static headers and environment-mapped headers.
 * @returns True when either names Authorization, in any case.
 */
export function hasAuthorizationHeader(config: Pick<StreamableHttpConfig, 'headers' | 'headerEnv'>): boolean {
  return [...Object.keys(config.headers), ...Object.keys(config.headerEnv ?? {})]
    .some(name => name.toLowerCase() === 'authorization')
}

/**
 * Whether an error, or one of its causes, means the server refused the request's
 * credential: a sign-in error, an unauthorized response, a
 * `403 insufficient_scope` challenge, or any HTTP 401. The Streamable HTTP
 * transport reports a plain 401 with the status only in the error data, so the
 * status is checked alongside the message.
 *
 * A server with a sign-in flow answers a refusal with `auth-required`; one whose
 * credential is a static `Authorization` header has no flow to run and reports a
 * failure instead.
 *
 * @param error Failure from a connection attempt or request.
 * @returns True when the server refused the request's credential.
 */
export function isAuthRequired(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current instanceof AuthRequiredError || current instanceof UnauthorizedError) return true
    if (current instanceof InsufficientScopeError) return true
    if (current instanceof SdkHttpError && (current.code === SdkErrorCode.ClientHttpAuthentication || current.status === 401)) return true
    if (/HTTP 401/.test(current.message)) return true
    current = current.cause
  }
  return false
}

function isGrant(value: unknown, url: string): value is McpGrant {
  return typeof value === 'object' && value !== null && (value as { url?: unknown }).url === url
}

/**
 * A grant held in memory for one sign-in attempt, before it is committed.
 * @param url Server URL the grant belongs to.
 * @returns The store.
 */
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

/**
 * The grant kept in the credentials service, ignoring a record made for another URL.
 * @param ctx Context that may hold the credentials service.
 * @param key Credential key of the grant.
 * @param url Server URL the grant belongs to.
 * @returns The store.
 */
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

/** OAuth client provider that reads and writes a {@link GrantStore}, registering as a public client. */
export class GrantProvider implements OAuthClientProvider {
  /** State sent with the last authorization request, checked against the callback. */
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

  /** @param url Authorization page the user must open. */
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

/** Bearer source whose unauthorized handler is always present. */
export type SignInProvider = AuthProvider & Required<Pick<AuthProvider, 'onUnauthorized'>>

/**
 * Bearer source for a connection: the stored access token, refreshed on 401.
 * @param serverName Server named in sign-in errors.
 * @param store Grant store of that server.
 * @returns Provider that throws {@link AuthRequiredError} when no refresh can succeed.
 */
export function grantAuthProvider(serverName: string, store: GrantStore): SignInProvider {
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
