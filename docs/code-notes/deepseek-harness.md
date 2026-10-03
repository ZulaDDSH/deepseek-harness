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

`packages/hooks/hook-protocol/src/inventory.ts:HookInventoryReport`, `packages/hooks/hooks-codex/src/index.ts:apply`, `packages/hooks/hooks-claude-code/src/index.ts:apply`, `packages/host/plugin-inventory/src/index.ts:readPluginInventory`, and `packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection` publish loaded hook configuration through a synchronous collector; loaded commands can be toggled (see `hookKey` below). The source file is not reread, disposal removes reports, and loaded status does not establish execution.

- `packages/hooks/hook-protocol/src/inventory.ts:hookKey`: a hook's identity is `[event, matcher, command]` after substitution. Bridges (`hooks-claude-code`, `hooks-codex`) keep a volatile `enabledHooks` allow-list of these keys and run only those in `runPoint` (default-deny: a new or edited external hook has a new key and stays off), and report `disabled` plus their `entryId` through `hooks/inventory`. The external hook files themselves are never edited, so disabling a hook in DSH does not affect Claude Code or Codex.
- `packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection`: toggles write `enabledHooks` to the bridge entry named by the report's `settingsNs` (`ctx.fiber.entry.options.id`; the Loader `entry.id` carries an `include/` prefix that settings does not accept); externally configured sources are hidden through `remote.settings.mutate`; only `loaded` reports carry an `entryId`, so externally configured sources stay read-only.
- `packages/client/ui-settings-models/src/client/ProviderEditor.tsx:ProviderEditor` (Jev routes): provider, model and reasoning effort are `<select>` controls fed by the Host model catalog (`remote.session.modelCatalog`) merged with each profile's own `models`. A stored value missing from the catalog is kept as an extra option, and a "Custom…" option falls back to free text.
- `packages/api/session-controller/src/hook-overrides-projection.ts:installHookOverridesProjection`: per-Session hook overrides are a log-only `hooks/session-overrides` event folded into the `hookOverrides` projection (complete map, `hookKey` → enabled). `SessionController.listHooks`/`setHookOverrides` serve the composer `hooks` popup in `packages/client/ui-conversation/src/client/apply.ts`; both bridges' `runPoint` apply the Session map over the global `enabledHooks`, so a Session can enable a globally disabled hook or disable an enabled one.
- `packages/llm/llm-jev-router/src/index.ts:apply` records each `agent/pre-step` outcome as a log-only `jev/decision` session event (choice, confidence, applied provider/model, or the error), because `failOpen` otherwise hides failures and a route that resolves to the base model is indistinguishable in the transcript.
- `packages/llm/llm-jev-router/src/index.ts:apply` registers its `agent/request` listener on each `agent.ctx` at the first enabled `agent/pre-step`, after Agent setup, so it wraps the per-Session `installModelSelection` listener (`packages/core/agent/src/model-selection.ts`). Cordis orders prepended listeners by registration time; the earlier global listener was always overwritten by the composer model selection.
