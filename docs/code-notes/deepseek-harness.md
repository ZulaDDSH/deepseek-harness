# DeepSeek Harness code notes

`scripts/project-doc-site.spec.ts:publishableImage` tests external image rejection through a directory link. Windows uses a junction so the negative case does not depend on file-symlink privileges.

`packages/client/ui-conversation/src/client/apply.ts:apply` registers the desktop folder and Session connector menu actions through the existing command registry. Folder selections retain their captured Session binding and use the existing reference grammar. `packages/api/session-controller/src/agent.ts:ApiSessionAgentController.installMcpSelection` refreshes inherited tool restrictions when the tool registry changes, removes disabled namespaces from schemas and server sections, and guards shared resource tools using their requested server. `packages/client/ui-plugin-manager/src/client/index.ts:apply` contributes profile management navigation to the Session command menu.

English | [中文](deepseek-harness.zh.md)

## Workflow repository targeting

`.github/issue-management/github.mjs:repositoryTarget` resolves GitHub API requests to the repository that launched the workflow when `DSH_ISSUE_REPOSITORY` is present; local policy tests retain the canonical project fallback. Automated pull requests do not need Project lifecycle work or Cloudflare previews, so the corresponding workflows skip those external integrations for bot-authored pull requests.

Reference: `.github/workflows/ci.yml:node` and `scripts/ci-workflow.spec.ts:workflow`. Pull-request Linux and Windows lanes use standard GitHub-hosted runners by default; `DSH_CI_FAILOVER_LINUX`, `DSH_CI_FAILOVER_WINDOWS`, and their explicit Blacksmith or self-hosted values retain the opt-in alternatives.

Reference: `packages/api/settings-controller/src/request.ts:settingsRequest.parse`. Authorization and credential request validation share one parser so the duplication gate does not accept two copies of the same wire-error mapping.

## Jev routing

`packages/llm/llm-jev-router/src/index.ts:apply`: Jev is a decision endpoint, not an LLM adapter. The plugin classifies admitted agent-step messages in `agent/pre-step`, caches the result for retries, and applies an allow-listed provider/model in `agent/request`. It is disabled by default and resolves its API credential per request.

`packages/llm/llm-jev-router/src/index.ts:Config`: `enabled` controls activation; `apiKeyEnv` is a credential reference; `endpoint` and `model` select TypeSafe; `timeoutMs`, `minConfidence`, and `stateMaxChars` bound the decision; `fallback` and `failOpen` define failure behavior; `routes` is the provider/model allowlist.

`packages/llm/llm-jev-router/src/index.ts:JevRoute`: `id` is the Jev choice; `provider`, `model`, and optional `reasoningEffort` are the DSH destination; `description` is sent as Jev choice criteria.

## Model selection precedence

`packages/core/agent/src/model-selection.ts:installModelSelection`: the prepended `agent/request` listener applies the assembled selection after downstream resolvers return. The selected provider, model, and reasoning effort therefore remain authoritative when a router also prepends its listener.

## Client type boundaries

`packages/deliverables/workspace-changes/src/types.ts` and `packages/client/ui-deliverables/src/changes.ts`: client-reachable code imports `WorkspaceId` from `@deepseek-ai/dsh-workspace/types`, not the package root. The root entry imports the `@deepseek-ai/dsh-session` root, whose `Context.sessions: SessionStore` augmentation conflicts with the client `ISessions` declaration in `packages/api/session-controller/src/client/index.ts`. The type-aware linter resolves project-reference declarations to source and therefore sees that transitive augmentation, which tsc does not, and reports `ctx.sessions` in `packages/client/ui-open-in-app/src/client/index.ts` as an error type.

`packages/test-support/client-runtime/src/index.ts:SlotTestRuntime.mount` is `async` so that callers passing it to promise-returning slots satisfy `no-misused-promises` without per-call-site wrappers.

## Projection cleanup

`packages/boot/app-boot/src/profile.ts:removeLinkProjections` unlinks direct and scoped projection junctions before removing their real containing directory. Electron 44 carries Node 24.18.1, whose recursive removal fails on a cyclic Windows junction with errno -4094; the build host Node 24.19.0 does not reproduce that failure. `packages/boot/app-boot/tests/profile.spec.ts:removeLinkProjections` exercises direct and scoped cyclic projections with per-case unlink cleanup; the regression is validated on the packaged Electron runtime.

## Model usage display

`packages/llm/llm-pi-ai/src/catalog.ts:catalogModels` removes recency labels from pinned defaults while retaining user names. `packages/client/ui-provider-quota/src/client/ProviderQuotaAction.module.css:.popover` uses the defined opaque floating fill. `packages/llm/token-meter/src/model-usage-projection.ts:modelUsageProjectionDefinition` groups durable reported usage by actual routes and reuses settlement/retry accounting. `packages/llm/llm-pi-ai/src/codex-quota.ts:createCodexQuotaSource` keeps credential refresh provider-owned; `packages/api/quota-controller/src/index.ts:QuotaController.registerSource` retains effect-based disposal.

`packages/llm/llm-pi-ai/src/codex-quota.ts:createCodexQuotaSource` creates the model collection only for configured account reads. `packages/experimental/webworker-runtime/src/node/external_packages/pi-ai.ts:builtinModels` rejects authentication operations unsupported by the worker.

`packages/client/ui-provider-quota/src/client/ProviderQuotaAction.tsx:sessionTokenLabel` formats required model usage and leaves absent session usage to the caller. `.github/workflows/ci.yml:refresh-web-snapshots` runs the selected web-session owners on Linux and uploads their current-writer outputs for review.

`apps/web/tests/preview-boot.e2e.ts:respond` normalizes URL paths with POSIX separators before matching generated asset keys; filesystem joins remain platform-native.

## Memory workspace

`scripts/graphify-native.py:memorix_graph` reconstructs complete active document imports from a read-only Memorix snapshot and passes their text to Graphify's Markdown extractor, builder, community detector and HTML exporter. Partial imports are excluded. The graph contains saved documents only; structural headings and explicit references do not imply semantic inference. `packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace.graph` serializes rebuilds and regenerates this derived view when opened or refreshed; graph failures do not undo stored memories.

`packages/knowledge/knowledge-router/src/memorix-types.ts` contains the platform-neutral browser values; generated Client RPC declarations import this leaf without loading Host Agent services.

`packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace` browses the connected Memorix store and imports retained documents through the live provider. `packages/knowledge/knowledge-router/src/memorix-store.ts:memorixStoredChunk` verifies the acknowledged observation and project, topic and complete narrative. `packages/client/ui-memory-workspace/src/document-text.ts:documentText` extracts text with the existing PDF and Office providers; originals remain separate from model requests. `packages/mcp/mcp-client/src/human-operations.ts:registerHumanOperations` exposes effect-scoped Host access to discovered, filtered tools without an Agent tool-execution token.

`packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace.loadGraph` invokes the installed Graphify HTML exporter; `src/client/MemoryPage.tsx:MemoryPage` embeds the unmodified viewer with scripts permitted and same-origin access denied. `packages/knowledge/knowledge-router/src/graphify-command.ts:registerGraphifyCommand` invokes the same configured provider from chat workspace paths. `scripts/graphify-native.py:run` calls Graphify’s structural label function and official CLI in one Python process; it owns no graph layout or clustering algorithm.

`packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts:chatViewDefinition.isActive` treats nonempty slash-command result text as visible conversation activity while leaving commands without text in the starter layout.

`scripts/package-dependency-policy.ts:PEER_REQUIRED_HOST_EXPORTS` keeps Memorix storage reads, Office identifiers, home paths and native command execution on shared Host peer instances. `packages/client/ui-memory-workspace/tsconfig.client.json` and `packages/api/remotes/tsconfig.client.json` consume generated Remote declarations without referencing the Memory Host project.

`packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace` registers `memorix_import_file` with the existing tool registry and filesystem. Reads resolve against the calling chat workspace, honor filesystem confinement and combine caller cancellation with plugin teardown; the panel and tool share document retention and provider read-back. `src/client/MemoryPage.module.css` sets native option colors and the active dark color scheme. The package `./types` export exposes declarations only, following `ui-settings-general`, so raw Client JavaScript with CSS imports is not published.

`packages/hooks/hook-protocol/src/inventory.ts:HookInventoryReport`, `packages/hooks/hooks-codex/src/index.ts:apply`, `packages/hooks/hooks-claude-code/src/index.ts:apply`, `packages/host/plugin-inventory/src/index.ts:readPluginInventory`, and `packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection` publish loaded hook configuration through a synchronous collector, and Settings lists it with the enablement controls described below. The source file is not reread, disposal removes reports, and loaded status does not establish execution.

`packages/hooks/hook-protocol/src/inventory.ts:hookEnabled` is the single hook enablement rule used by both bridges (`runPoint`) and `describeHookHandlers`. A hook's identity is `hookKey` = `[event, matcher, command]` after substitution. A Session override wins; otherwise the hook runs only when the bridge's volatile `enabledHooks` names its key or contains `ALL_HOOKS` (`'*'`). Default-deny means a new or edited external hook has a new key and stays off. The wildcard is for operator-written compositions such as `snapshots/session/text-turn/cordis.yml`; Settings writes explicit keys only.

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection` lists only reports that carry `settingsNs` (`ctx.fiber.entry.options.id`), which only a mounted bridge sets; external file reports from `packages/host/plugin-inventory/src/hook-files.ts:readHookFiles`, including failed parses, are not controllable and are hidden. Toggles and descriptions write `enabledHooks` and `hookDescriptions` to that namespace through `remote.settings.mutate`; the Loader `entry.id` carries an `include/` prefix that settings rejects.

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:hookName` names a hook by its script basename after the last `/` or `\`, so a Windows command such as `node "C:\hooks\check.mjs"` shows as `check`. `HooksSettingsSection` uses `settingsNs` directly as the write namespace: a bridge that failed to load reports no handlers (`packages/hooks/hooks-codex/src/index.ts:apply` leaves `parsed` empty), so handler rows and their controls never appear without a loaded bridge.

`packages/api/session-controller/src/hook-overrides-projection.ts:installHookOverridesProjection` folds the log-only `hooks/session-overrides` event into the `hookOverrides` projection. `SessionController.listHooks` and `setHookOverrides` serve the composer `hooks` popup in `packages/client/ui-conversation/src/client/apply.ts`.

`packages/client/ui-settings-models/src/client/ProviderEditor.tsx:ProviderEditor` renders Jev route provider, model and reasoning effort as selects fed by the Host model catalog merged with each profile's `models`; a stored value missing from the catalog stays selectable and a custom option falls back to free text.

`packages/llm/llm-jev-router/src/index.ts:apply` decides once per user turn and reuses the decision for every step, caching failures as "no route" so a turn calls Jev at most once. Each outcome is recorded as the log-only `jev/decision` event. The `agent/request` listener is registered on `agent.ctx` at the first enabled `agent/pre-step` so it wraps the per-Session `installModelSelection` listener; an unrouted step resolves to `modelSelection.selected`, else `agent.options`, instead of the route persisted by an earlier step.

`packages/boot/plugin-manager/src/mcp-servers.ts:discoverMcpServers` reads Claude Desktop, Claude Code (top-level and per-project `mcpServers`) and Codex (`config.toml` `mcp_servers`); SSE servers are skipped because `dsh-mcp-client` speaks stdio and streamable HTTP only. `PluginManager.addMcpServer` appends a profile `insert` row with id `mcp-<serverName>`, `removeMcpServer` deletes that insert and any direct rows for the id, and enablement reuses `setPluginEnabled`.

`packages/knowledge/knowledge-router/src/index.ts:KnowledgeRouter` registers `/graphify` only when `config.graphify.cli.command` is a string. The `Config` schema fills `graphify.cli` with `{ args: [] }` even when no launcher is configured, so testing `cli !== undefined` registered a command that would run an undefined executable.

`packages/client/ui-memory-workspace/src/document-text.ts:documentText` keeps only text items from `getTextContent()`. Marked-content items exist only when `includeMarkedContent` is requested, which this call leaves off, so the filter is a type narrowing and never drops content.

`packages/client/ui-plugin-manager/src/client/McpServersSection.tsx:reason` turns a rejected list, discovery or change call into its message, using `String(error)` for values that are not `Error` instances, so a rejection from the transport layer is never shown as a blank alert.

`packages/client/ui-settings-models/src/client/ModelsSection.tsx:Loaded` leaves `jev-router` out of the provider rows. `packages/llm/llm-jev-router/src/index.ts:apply` registers a configurable provider only so `JevSettingsSection` can read its settings namespace from the shared join. Jev is a routing service, not an adapter route, so listing it on the Models page would offer a key field and, on first run, a setup card that does not give the user a model provider.

`packages/llm/llm-pi-ai/src/catalog-supplement.ts:SUPPLEMENT` carries the `opencode-go` models the pinned pi-ai catalog lacks, transcribed from `opencode models opencode-go --verbose` (OpenCode 1.18.33): `deepseek-v4.1-flash`, `gpt-6-luna`, `grok-4.7`, `longcat-2.5-preview-free`, `mimo-v2.6-flash`, `mimo-v2.6-pro` and `space-bunny-free`. A pi-ai `Model` accepts only text and image input, so audio, video and PDF modalities are dropped, and tiered long-context prices use the base rate. OpenAI-protocol models use `openai-responses` with `sessionAffinityFormat: 'openai-nosession'`, as the installed sibling routes do; the rest reuse the installed OpenAI-compatible `compat`.

`packages/client/ui-settings-models/src/client/ProviderEditor.tsx:applyOnce` describes the stored credential again right after `storeCredential` succeeds. The key hint is otherwise fetched once per credential reference, so Apply cleared the field while the placeholder still read as unset on a card that stays mounted. `packages/client/ui-settings-models/src/client/JevSettingsSection.tsx:JevSettingsSection` announces a successful save with the shared `savedProvider` copy, because its close handler only reloads and the page otherwise looked unchanged. A refused follow-up read cannot undo a successful write, so `applyOnce` falls back to a configured, writable state when `describeCredential` returns `undefined`. `JevSettingsSection` clears the confirmation when a new Apply starts and when the edit is cancelled, so a failed second Apply never shows the earlier "Saved" message beside its error.

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection` filters hooks with one search box over the source file, dialect, script name, event with matcher, command and description. A script group stays whole when any of its handlers match, so a group toggle still acts on every handler it names; the bulk Enable all and Disable all buttons are hidden while searching because they act on the whole file, including rows the filter hides. The source file and each command are printed as text instead of tooltips, which is how a user finds the file that defines a hook. `hooksEmpty` now says that only loaded hook bridges are listed, since external hook files are never shown on this page.

## MCP connection status and OAuth sign-in

`packages/mcp/mcp-client/src/status.ts:McpConnectionReport` is the truthful connection state of one HTTP or stdio MCP server: `connecting`, `connected` with its tool count, `auth-required`, or `failed` with the error. `packages/mcp/mcp-client/src/connection.ts:startConnection` answers the `mcp-client/inventory` event, and `packages/boot/plugin-manager/src/index.ts:PluginManager.listMcpServers` emits it and copies each report into `McpServerRow.connection`. Before this, a plugin whose fiber was active showed "Running" even when the server answered 401 and registered no tools.

`packages/mcp/mcp-client/src/connection.ts:startConnection` does not schedule reconnect attempts while a server needs sign-in: a 401 would repeat forever. The attempt settles as `auth-required` and restarts only when `credentials/record-updated` reports the server's grant record, which a completed sign-in writes. An established connection also drops to `auth-required` when its grant stops working: `startConnection` reads every request failure from the client's transport error seam, and when `oauth.ts:isAuthRequired` reports sign-in required `signInLost` closes the generation without scheduling a reconnect. That covers a retry the transport refused after a successful token refresh, a `403 insufficient_scope` challenge no stored grant can satisfy, and the plain 401 a static `Authorization` header gets, none of which then stays reported as `connected`. A server whose credential is that static header offers no sign-in flow, so `startConnection` reports the refusal as `failed` with the credential error instead of entering `auth-required`, which nothing could leave. The close waits one event-loop turn so the failing tool or resource request still rejects with the sign-in error the model reads. A refresh failure of any kind ends there, because the SDK falls back to a fresh authorization that `grantAuthProvider` turns into `AuthRequiredError`; only an unreachable authorization server leaves the connection as it was. `packages/client/ui-plugin-manager/src/client/McpServersSection.tsx:McpServersSection` re-reads the list every 1.5 s while a server is connecting and every 10 s while any enabled server reports a connection state, so a later loss of sign-in or connection shows without user action.

`packages/mcp/mcp-client/src/oauth-flow.ts:signIn` reuses the model-provider seams: `registerOAuthFlow` registers an `authorization` flow, tokens and the dynamic client registration live in a credential `grant` record (`oauth.ts:grantKey`), and the browser reaches it through the `authorization` Remote namespace. `listenForCallback` binds the redirect listener to `127.0.0.1` on the Harness host, so sign-in completes only when the browser runs on that same machine; a browser on another device cannot reach the callback.

`packages/mcp/mcp-client/src/oauth-flow.ts:offerSignIn` skips OAuth when the server config already carries an `Authorization` header (`oauth.ts:hasAuthorizationHeader`), in `headers` or `headerEnv`. A static token is then the only credential and a 401 is reported as `failed`, not `auth-required`.

`packages/client/ui-plugin-manager/src/client/McpServersSection.tsx:McpServersSection` sends the Headers field as `headers` in the profile patch row. Header values, including tokens, are stored in plaintext in the profile's `cordis.patch.yml`; the form hint says so, and `headerEnv` remains the way to keep a secret out of the file.

`packages/client/ui-plugin-manager/src/client/index.ts:apply` gives the MCP section its own `signInMcpServer` callback instead of reusing the Models page sign-in. A feature plugin may not import another plugin's component or value, so the section drives `remote.authorization.begin` itself, relays its notices, and treats a stream that ends after the user cancelled as settled rather than as an error.

## Jev settings form

`packages/client/ui-settings-models/src/client/JevFields.tsx:JevFields` renders the Jev router settings, moved out of `ProviderEditor.tsx:ProviderEditor`, which keeps only the API key field. Picking a route's model fills its ID from the model name (`routeIdFor`), adding `-2`, `-3`… when another route already uses it. A model change sets the ID again unless the user typed that row's ID in this editing session; `typedIds` records those rows, so a typed value such as `model-7` is never replaced. `ProviderEditor.tsx:applyOnce` refuses to save duplicate route IDs or a fallback that names no route (`jevConfigFailure`), the two checks `llm-jev-router` applies at load. The fallback is a select of `keep` and the configured route IDs, and renaming or deleting the route it names updates it. `packages/llm/llm-jev-router/src/index.ts:apply` refuses a fallback that names no configured route, which the old free-text field allowed. Each setting carries a plain-language hint linked through `aria-describedby`.
