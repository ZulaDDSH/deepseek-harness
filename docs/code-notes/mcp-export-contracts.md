# MCP client export contract notes

### `packages/mcp/mcp-client/src/connection.ts:ConnectionAuth`
- `description`: Optional grant-backed authentication for an MCP connection. `key` identifies the stored credential, and `providerFor` creates an OAuth provider for the resolved server URL.

### `packages/mcp/mcp-client/src/connection.ts:startConnection`
- `params.auth`: Optional grant binding. When supplied for a resolved Streamable HTTP transport, its provider is passed to the generation; stdio connections do not use it.

### `packages/mcp/mcp-client/src/generation.ts:McpGeneration.connect`
- `params.authProvider`: Optional MCP SDK auth provider, used by Streamable HTTP transports.
- `params.environment`: Optional complete child environment for stdio transport creation; when omitted, the transport builds one from its config.

### `packages/mcp/mcp-client/src/human-operations.ts:McpHumanOperations`
- `description`: Operations exposed for a named MCP server to human-facing features. `local` distinguishes stdio from HTTP, `cwd` and `env` describe the current local server process, and `call` invokes a server tool with caller cancellation.

### `packages/mcp/mcp-client/src/human-operations.ts:registerHumanOperations`
- `description`: Register a `mcp/human-operations` provider for one server name. Calls from a scoped Cordis context are ignored; otherwise requests for that server receive `operations` and requests for other servers continue through the event waterfall.
- `params.ctx`: Cordis context that owns the event listener; a scoped context does not register it.
- `params.server`: Exact MCP server name matched by the listener.
- `params.operations`: Human-facing operations provided when the matching server is requested.

### `packages/mcp/mcp-client/src/oauth-flow.ts:CallbackListener`
- `description`: A loopback OAuth callback listener. `redirectUrl` is its `/callback` URL; `params` resolves with the callback query and rejects on timeout or abort; `close` stops the listener and clears its cancellation resources.

### `packages/mcp/mcp-client/src/oauth-flow.ts:listenForCallback`
- `description`: Start a temporary HTTP callback listener on loopback for OAuth sign-in.
- `params.signal`: Abort signal that rejects the callback-parameter promise.
- `params.timeoutMs`: Maximum wait in milliseconds before the callback promise rejects; defaults to five minutes.
- `returns`: A listener with the loopback redirect URL, callback query promise, and a close operation.

### `packages/mcp/mcp-client/src/oauth-flow.ts:signIn`
- `description`: Complete an interactive OAuth sign-in for one MCP server, validate the returned state, exchange its authorization code, and commit the resulting grant through the authorization session.
- `params.serverName`: Server name shown in the sign-in notice and refusal error.
- `params.url`: Resolved Streamable HTTP server URL used for OAuth authorization.
- `params.session`: Authorization session that supplies cancellation and notification and receives the committed grant.

### `packages/mcp/mcp-client/src/oauth-flow.ts:registerOAuthFlow`
- `description`: Register the user's OAuth sign-in flow for one MCP server; the flow resolves its configured endpoint and rejects non-Streamable HTTP transports.
- `params.ctx`: Cordis context providing the authorization service and template bindings.
- `params.serverName`: Server name used for the flow label and sign-in notice.
- `params.config`: Resolved MCP client configuration used to resolve the server endpoint.
- `params.key`: Credential key under which the authorization session stores the grant.

### `packages/mcp/mcp-client/src/oauth-flow.ts:offerSignIn`
- `description`: Enable OAuth sign-in when the configured transport is Streamable HTTP and no Authorization header is already configured.
- `params.ctx`: Cordis context used to register the flow and create the credential-backed grant store.
- `params.config`: MCP client configuration selecting the server name, transport, and headers.
- `returns`: The credential key and provider factory for OAuth-capable HTTP configuration, or `undefined` when sign-in is not offered.

### `packages/mcp/mcp-client/src/oauth.ts:GRANT_SCOPE`
- `description`: Credential scope used for MCP OAuth grants (`mcp-client`).

### `packages/mcp/mcp-client/src/oauth.ts:McpGrant`
- `description`: OAuth grant data associated with one exact MCP server URL, including optional SDK client information and tokens. Grant stores ignore records whose URL does not match.

### `packages/mcp/mcp-client/src/oauth.ts:GrantStore`
- `description`: Asynchronous storage for one MCP OAuth grant. `read` returns the current matching grant or `undefined`; `update` applies a partial grant update.

### `packages/mcp/mcp-client/src/oauth.ts:AuthRequiredError`
- `description`: Error indicating that an MCP server needs interactive sign-in; authentication classification recognizes this error type.

### `packages/mcp/mcp-client/src/oauth.ts:grantKey`
- `description`: Derive the credential key used to store grants for an MCP server name.
- `params.serverName`: MCP server name used to create the stable credential identifier.
- `returns`: A credential key in the `mcp-client` scope.

### `packages/mcp/mcp-client/src/oauth.ts:hasAuthorizationHeader`
- `description`: Check whether a Streamable HTTP config supplies an Authorization header directly or through an environment-variable mapping.
- `params.config`: The config's `headers` and `headerEnv` maps.
- `returns`: `true` when either map contains an Authorization header name, compared without case sensitivity.

### `packages/mcp/mcp-client/src/oauth.ts:isAuthRequired`
- `description`: Classify recognized MCP authentication failures, including known SDK errors, HTTP 401 errors, and their short `Error.cause` chains.
- `params.error`: Unknown thrown value to inspect.
- `returns`: `true` for a recognized authentication-required error; otherwise `false`.

### `packages/mcp/mcp-client/src/oauth.ts:memoryGrantStore`
- `description`: Create an in-memory grant store initialized for one server URL; updates are shallow-merged and are not persisted.
- `params.url`: Exact server URL associated with the grant.
- `returns`: A `GrantStore` backed by local in-memory state.

### `packages/mcp/mcp-client/src/oauth.ts:recordGrantStore`
- `description`: Create a grant store backed by the Cordis credentials service. Reads accept only grant records for the same URL; updates fail if the credentials service is unavailable.
- `params.ctx`: Cordis context providing the credentials service.
- `params.key`: Credential key containing the grant record.
- `params.url`: Exact server URL that the stored grant must match.
- `returns`: A credentials-backed `GrantStore`.

### `packages/mcp/mcp-client/src/oauth.ts:GrantProvider`
- `description`: MCP SDK OAuth provider that persists client information and tokens through a `GrantStore`, generates OAuth state, stores and returns the PKCE verifier supplied by the SDK, and forwards authorization redirects to its callback.

### `packages/mcp/mcp-client/src/oauth.ts:GrantProvider.expectedState`
- `description`: The latest OAuth state generated by `state()`, used to validate the loopback callback for the active authorization attempt.

### `packages/mcp/mcp-client/src/oauth.ts:GrantProvider.redirectToAuthorization`
- `params.url`: Authorization URL supplied by the MCP SDK; it is forwarded to the provider's redirect callback.

### `packages/mcp/mcp-client/src/oauth.ts:SignInProvider`
- `description`: MCP SDK auth provider with a required unauthorized-response hook for retrieving or refreshing the stored server grant.

### `packages/mcp/mcp-client/src/oauth.ts:grantAuthProvider`
- `description`: Build an MCP SDK auth provider from a server name and grant store. It supplies the stored access token, refreshes on unauthorized responses, and turns missing refresh credentials or an `invalid_grant` response into `AuthRequiredError`.
- `params.serverName`: Server name included in the sign-in-required error.
- `params.store`: Grant store containing this server's client information and tokens.
- `returns`: An auth provider with a required unauthorized-response handler.

### `packages/mcp/mcp-client/src/status.ts:McpConnectionState`
- `description`: Public inventory state: `connecting`, `connected`, `auth-required`, or `failed`.

### `packages/mcp/mcp-client/src/status.ts:McpConnectionReport`
- `description`: Inventory entry for one configured MCP server: its name, public connection state, connected tool count, optional error text, and optional credential key when OAuth sign-in is available.

### `packages/mcp/mcp-client/src/tool-filter.ts:ToolFilterConfig`
- `description`: Optional exact-name allow and deny lists for MCP server tools. When both match a name, the deny list takes precedence.

### `packages/mcp/mcp-client/src/tool-filter.ts:ResolvedToolFilter`
- `description`: Immutable normalized tool filter with an optional non-empty allow list and an always-present deny list.

### `packages/mcp/mcp-client/src/tool-filter.ts:resolveToolFilter`
- `description`: Validate and freeze a tool filter. Omission and an empty allow list mean unrestricted access; omitted deny becomes an empty list. Unknown keys, non-array lists, empty names, and duplicate names throw an error naming `path`.
- `params.config`: Optional raw allow/deny configuration.
- `params.path`: Config path prefix used in validation errors.
- `returns`: Frozen allow/deny filter with empty allow omitted and empty deny supplied by default.

### `packages/mcp/mcp-client/src/tool-filter.ts:toolAllowed`
- `description`: Decide whether one raw server tool name passes a resolved allow/deny filter; deny takes precedence over allow.
- `params.filter`: Resolved filter, or `undefined` to allow every name.
- `params.rawName`: Exact tool name reported by the MCP server.
- `returns`: `true` when the name is not denied and is present in any configured allow list.

### `packages/mcp/mcp-client/src/transport.ts:buildChildEnv`
- `params.extra`: Explicit stdio environment values, which override values from the scrubbed parent environment.
- `returns`: Environment record combining the scrubbed parent environment with `extra`.

### `packages/mcp/mcp-client/src/transport.ts:HttpHeaderConfig`
- `description`: Streamable HTTP header configuration. `headers` supplies literal values; `headerEnv` maps header names to process environment variable names.

### `packages/mcp/mcp-client/src/transport.ts:resolveHttpHeaders`
- `description`: Resolve literal and environment-backed HTTP headers. A literal value wins for the same header key; a missing or empty environment variable is skipped unless `required` is true, when it throws.
- `params.config`: Literal headers and environment-variable mappings to resolve.
- `params.required`: Whether a missing or empty mapped environment variable is an error; defaults to `false`.
- `returns`: Resolved header-name/value record.

### `packages/mcp/mcp-client/src/transport.ts:createTransport`
- `params.authProvider`: Optional MCP SDK OAuth provider used only for Streamable HTTP transport.
- `params.environment`: Optional stdio child environment; when provided it replaces the environment derived from `config.env`.
