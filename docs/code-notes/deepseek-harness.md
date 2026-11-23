# DeepSeek Harness code notes

`scripts/project-doc-site.spec.ts:publishableImage` tests external image rejection through a directory link. Windows uses a junction so the negative case does not depend on file-symlink privileges.

`packages/client/ui-conversation/src/client/apply.ts:apply` registers the desktop folder and Session connector menu actions through the existing command registry. Folder selections retain their captured Session binding and use the existing reference grammar. `packages/api/session-controller/src/agent.ts:ApiSessionAgentController.installMcpSelection` refreshes inherited tool restrictions when the tool registry changes, removes disabled namespaces from schemas and server sections, and guards shared resource tools using their requested server. `packages/client/ui-plugin-manager/src/client/index.ts:apply` contributes profile management navigation to the Session command menu.

## Workflow repository targeting

`.github/issue-management/github.mjs:repositoryTarget` resolves GitHub API requests to the repository that launched the workflow when `DSH_ISSUE_REPOSITORY` is present; local policy tests retain the canonical project fallback. Automated pull requests do not need Project lifecycle work or Cloudflare previews, so the corresponding workflows skip those external integrations for bot-authored pull requests.

Reference: `.github/workflows/ci.yml:node` and `scripts/ci-workflow.spec.ts:workflow`. Pull-request Linux and Windows lanes use standard GitHub-hosted runners by default; `DSH_CI_FAILOVER_LINUX`, `DSH_CI_FAILOVER_WINDOWS`, and their explicit Blacksmith or self-hosted values retain the opt-in alternatives.

Reference: `packages/api/settings-controller/src/request.ts:settingsRequest.parse`. Authorization and credential request validation share one parser so the duplication gate does not accept two copies of the same wire-error mapping.

## Model selection precedence

`packages/core/agent-loop/src/agent.ts:ReactLoopAgent.preStep`: the loop claims the inbox, captures `agent.model.current()` synchronously, and only then awaits the `agent/route` waterfall. The routed selection replaces the captured one for that step: assembly, tools, `agent/pre-step.modelSelection` and the request all use it, and `request/header` records it as `lastUsed`. Nothing writes `model/selection`, so the user's pending pick survives the turn. A `send()` that wakes an idle driver runs this first `preStep` synchronously (`ReactLoopAgent.send` → `wakeDriver` → `kick` → `turn`), so a `model.select()` made right after `followup()` or `steer()` does not change that step's capture.

`packages/core/agent/src/model-selection.ts:installModelSelection`: installs only the model-switch notice in `agent/pre-step`, which compares the step's captured or routed selection with the last `request/header`. Route precedence therefore follows the loop: a routed selection is what the notice sees.

`packages/api/session-controller/src/setup-resolver.ts:orchestratorSelectionOf`: the Host drives a top-level Session from its own run-options setup override, or the global default when there is no override. A subagent child is not driven, and only an enabled setup with an `llm` orchestrator route drives the model. The selected route is returned by `packages/api/session-controller/src/agent.ts:ApiSessionAgentController.selectionFor` without writing a `model/selection` event.

`packages/api/session-controller/src/agent.ts:ApiSessionAgentController.selectionFor`: once the setup is turned off, the user's stored pick applies again. A Session with no stored pick falls back to the model of its last request, which may be a model the orchestrator drove, so it keeps that model until the user picks one. This is accepted: no write is made for the driven model, and the fallback is the one a Session without a setup uses too.

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

`packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace.loadGraph` counts imported document chunks with `memorixPage` view `'documents'` and returns `documents: 0` with empty html instead of running Graphify, because the adapter exits 0 on an empty store and the viewer would render blank.

`packages/client/ui-memory-workspace/src/client/MemoryPage.tsx:MemoryPage` keeps upload failures in `importError`, separate from `error`, because the post-import refresh clears `error`; the setup hint renders only when `unavailable` (inventory failed); the page-load effect clears `error`.

`packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts:chatViewDefinition.isActive` treats nonempty slash-command result text as visible conversation activity while leaving commands without text in the starter layout.

`scripts/package-dependency-policy.ts:PEER_REQUIRED_HOST_EXPORTS` keeps Memorix storage reads, Office identifiers, home paths and native command execution on shared Host peer instances. `packages/client/ui-memory-workspace/tsconfig.client.json` and `packages/api/remotes/tsconfig.client.json` consume generated Remote declarations without referencing the Memory Host project.

`packages/client/ui-memory-workspace/src/automation.ts:MemoryAutomation` saves memory without model cooperation. `SessionTurns.finish` numbers each completed turn and `turnRecord` gives it its own topicKey `dsh-session:<id>:<segment>:turn:<n>`, so every turn is appended and an earlier turn is never upserted over. The prompt and final answer are scrubbed by `scrub` and clipped to `memoryCharacters`; tool output is never saved. `MemoryAutomation.enqueue` writes immediately rather than after a quiet period, so a Host that stops right after a turn still saves it, and `MemoryAutomation.close` drains the queue. Compaction summaries keep their own checkpoint key. Subagent and interrupted turns are ignored. `MemoryAutomation.save` reads the row back with `memorixStoredChunk` where a database path exists and otherwise accepts the acknowledgement. `MemoryAutomation.report` warns once per distinct message and records the last failure for the Memory page; a success clears that action's failure.

`packages/client/ui-memory-workspace/src/automation.ts:memoryPolicy` is registered as the `memory:policy` section and renders empty unless `registeredToolName` finds the store tool in the visible tool set, so a profile without Memorix gets no prompt text. `MemoryAutomation.recallFirst` runs once per chat, when its first user message is inserted (`agent/inbox/inserted`). `MemoryAutomation.recallNotes` calls `memorix_search` for that message with `scope: 'project'` and `quality: 'fast'`, reads the returned `obs:<id>` references back with `memorixObservations`, and keeps only notes of this workspace entity that are not from this chat. The `system-prompt/assemble` hook awaits that promise, so the notes reach the first model request; the context renders at `MEMORY_RECALL` (125). `RECALL_BUDGET_MS` bounds the whole recall: an expired budget records a failure and falls back through `MemoryAutomation.recentNotes`. A search error or an empty result falls back the same way; `MemoryAutomation.recent` reads the newest notes of other chats through `memorixRecent`, and `recallText` labels the result as possibly stale.

`packages/client/ui-memory-workspace/src/automation.ts:MemoryAutomation.bind` calls `memorix_session_start` with the workspace folder before a write or search whenever the shared provider last bound another folder. The stdio server holds one project binding for all chats, so binding once per chat would send a later chat's writes to the earlier project. `MemoryAutomation.exclusive` runs every Memorix call through one queue, so a bind and the call that follows it never interleave with another chat's.

`packages/client/ui-memory-workspace/src/automation.ts:memoryProjectRoot` chooses the `projectRoot` that `MemoryAutomation.bind` sends. Memorix 1.9.10 binds only a Git root: `memorix_session_start` with an explicit `projectRoot` returns `Cannot bind session to project` with `isError` unless `switchProject` accepts it. `--allow-untracked` only changes the startup fallback to `untracked/<name>`, and `projectResolved` stays false, so `requireResolvedProject` refuses `memorix_store` and project-scoped `memorix_search` (`memorix/dist/cli/index.js:createMemorixServer`, `switchProject`, `requireResolvedProject`).

`packages/client/ui-memory-workspace/src/automation.ts:usableGitRoot` applies the part of that rule DSH can reproduce without a git process. `getGitRootWithDiagnostics` walks from the folder up to, but excluding, the filesystem root and accepts the first `.git` that is a directory or a file; `switchProject` then refuses a root equal to the home folder (`isHomeDirectory`, built from `USERPROFILE`/`HOME`), and `memorix_session_start` refuses a `projectRoot` that is the home folder. So a `.git` at the home folder (a dotfiles repository) counts as no repository. The immediate-child rule (`findGitInSubdirs`) is deliberately not mirrored: it binds the first child repository in directory order, so a parent folder of several repositories would take an arbitrary, unstable project id and share it with chats run inside that child. Such a folder gets its own project like any other.

`packages/client/ui-memory-workspace/src/automation.ts:ensureEmptyRepository` creates the project folder `dshHomePath('memorix-roots', workspaceHash(cwd))` for every other folder. Memorix only tests that `.git` exists (`existsSync` and `statSync`), so DSH writes `.git/HEAD`, `.git/objects` and `.git/refs/{heads,tags}` itself and never starts `git`; a machine without git on the PATH works, and `git rev-parse` accepts the result. The calls are asynchronous and idempotent: `mkdir` recursive, and `HEAD` written with `wx` so an existing file, or a concurrent writer in another DSH process, is left alone. `MemoryAutomation.exclusive` serializes binds within one process. Memorix names the project `local/<basename of the root>`, here the hash. A failure (read-only home, a file where the folder should be) throws `Cannot prepare the Memorix project folder`, which reaches the Memory page as the save or recall failure and never blocks a turn. The workspace folder itself is never written. The repository under `DSH_HOME` is not scanned by any DSH package: workspace scanners start from the session folder and only meet it if a session is opened inside `memorix-roots`. Memorix also records the bound root in `~/.memorix/last-project-root`.

`packages/client/ui-memory-workspace/src/automation.ts:workspaceHash` hashes `resolve(cwd)`, lower-cased on Windows, so a trailing separator, forward slashes and drive-letter case give the same entity and project folder. It does not follow symlinks, junctions or `subst` drives, and it does not fold case on macOS, so those spellings of one folder remain distinct workspaces.

`packages/client/ui-memory-workspace/src/automation.ts:MemoryAutomation.inProject` runs one write under `exclusive` after `bind`, and `packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace.importBytes` wraps every chunk store in it. The server keeps one binding for all chats, so an import that did not bind wrote to whichever project the last chat or the server's own startup folder had bound, and failed outright before any chat. The `memorix_import_file` tool passes the chat workspace, so the file is searchable from that workspace; a Memory page upload has no workspace and uses the shared `memorix-roots/documents` project. Binding per chunk keeps a chat save that runs between two chunks from redirecting the rest of the import. A binding failure becomes the import's `error`.

`apps/cli/tests/bundled-memorix.e2e.ts:saveTurnAndRecallInNextChat` runs the bundled server against a Git repository, a plain folder, and a plain folder with the PATH reduced to the Node directory so no git exists, each under a temp HOME and `DSH_HOME`, and requires a saved turn (no `saveFailure`) that the next chat recalls. It also imports a document with no chat first and requires the chunks under project `local/documents`. For a plain folder Memorix's diagnostic reads `git_safe_directory`: `getGitRootWithDiagnostics` matches `safe.directory` in the failed `git` command text, so the diagnostic is misleading and the real cause is the missing repository.

`packages/knowledge/knowledge-router/src/memorix-store.ts:REQUIRED_MIGRATIONS` is the minimum set of Memorix 1.9.10 migrations DSH reads. Extra migrations from a newer Memorix are tolerated; a missing one fails with a message that names it, and the database is never migrated. `packages/knowledge/knowledge-router/src/memorix-store.ts:observations` checks only the columns the caller reads: `memorixStoredChunk` needs `id`, `projectId`, `topicKey` and `narrative`, while `memorixObservations` (rows by id for recall) and `memorixRecent` need the full `OBSERVATION_COLUMNS`. A narrow check keeps an import read-back working against a fixture table that lacks the other columns.

`packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace.status` returns `server` (`ready`, `starting` or `unavailable`), the failure text when unavailable, the `MemoryAutomation.snapshot` of the last save and recall outcomes, and the live `chatMemory` value. `MemoryWorkspace.connectionStatus` cannot rely on `provider()` alone: `mcp/human-operations` is registered when the MCP client is created, so a client whose Memorix process never started still resolves a provider whose calls fail with `server is disconnected`. It therefore also reads the client's `mcp-client/inventory` report and maps `connected` to ready, `connecting` to starting and everything else to unavailable. `MemoryWorkspace.retry` emits `mcp-client/reconnect`, which `packages/mcp/mcp-client/src/connection.ts:ConnectionHandle.reconnect` answers with a fresh attempt and a new retry budget when the server is down, so the Retry button works after the client gave up. `src/client/MemoryPage.tsx:MemoryPage` polls `status` every 1.5 s while the server is starting, and the outcomes reset when the Host restarts.

`packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace` passes `chatMemory: () => config.chatMemory?.get() ?? true` into `MemoryAutomation`. `chatMemory` is declared `z.boolean().default(true).volatile()`, so the Settings row in `packages/client/ui-settings-general/src/client/ChatMemoryRow.tsx:ChatMemoryRow` changes saves and recall without a restart; the getter is read at each save and recall. Changing the `Volatile` value is not covered by a live test; only a plain boolean is.

`packages/bundle/web-app/cordis.patch.yml:memory-memorix` runs the Memorix that ships with the bundle. `packages/bundle/web-app/package.json` pins `memorix` 1.9.10 as a regular dependency, and `packages/bundle/web-app/src/memorix.ts:memorixLaunch` resolves its `cli/index.js` with `import.meta.resolve('memorix')` (the package exports only `.`, so `package.json` cannot be resolved) and provides `process.execPath` plus `serve --allow-untracked` as the `memorixLaunch` service that the row reads. The child runs with `ELECTRON_RUN_AS_NODE=1` so Desktop's Electron behaves as Node, and `MEMORIX_SQLITE_DRIVER=node` so no native SQLite binding is needed; this avoids a global install, a `PATH` lookup and the Windows `.cmd` shim. Memorix's own entry re-spawns `process.execPath` with a larger heap, inheriting that environment and its stdio. `pnpm-workspace.yaml:ignoredOptionalDependencies` drops `@lancedb/lancedb` (with its Hugging Face and onnxruntime stack) and `better-sqlite3`, which Memorix treats as optional. Memorix pins React 19, so `package.json` and `packages/client/store/package.json` declare React 18 as a dev dependency; without that, pnpm auto-installs the newly present React 19 as the peer of the root and store importers' React 18 packages. `scripts/verify-npm-install-layout.ts` accepts `react` only when `memorix` is in the install. Open item for the npm-published install: npm ignores the pnpm setting and installs Memorix's optional dependencies.

`packages/bundle/web-app/src/memorix.ts:backupExistingDatabase` copies an existing `memorix.db` (and its `-wal` and `-shm` files) once to `memorix.db.dsh-pre-1.9.10.bak` because Memorix 1.9.10 may upgrade an older database in place. The bundled launch hook logs backup failures and continues; `scripts/setup-memorix-desktop.mjs` imports the same function and fails without changing the profile if copying fails. Both use `MEMORIX_DATA_DIR`, then `~/.memorix/data`, matching `packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace.database`.

`packages/client/ui-memory-workspace/src/automation.ts:MemoryAutomation` hands the recall promise to the `system-prompt/assemble` hook, which waits for it or for `context.signal` to abort, whichever comes first, and returns an empty recall when the turn is aborted or `chatMemory` is off. Recall therefore never holds a turn longer than `RECALL_BUDGET_MS`, and turning the switch off removes notes that were already recalled for a session. `apps/cli/tests/bundled-memorix.e2e.ts` starts the real bundled server under a temporary home and proves a save followed by a recall in a second chat.

`pnpm-lock.yaml:importers` for `packages/bundle/web-app` was regenerated with `pnpm install --ignore-scripts --lockfile-only` after adding `memorix` 1.9.10, `@deepseek-ai/dsh-mcp-client` and `@deepseek-ai/dsh-tool-watch`; `pnpm install --frozen-lockfile` accepts it. The change adds the Memorix closure (about 60 packages, no native addon and no install script) and nothing is removed.

`packages/client/ui-memory-workspace/package.json` lists `dsh-compaction`, `dsh-session` and `dsh-util-values` as devDependencies only: `automation.ts` imports them for types. `dsh-agent` is also a peerDependency because `automation.ts` calls `cliTerminalProfileOf` at runtime, which `scripts/package-dependency-policy.ts:PEER_REQUIRED_HOST_EXPORTS` classifies as peer-required (it reads the context-bound `sessionProjections` service). `scripts/verify-package-dependencies.ts` rejects a runtime dependency that is never imported at runtime. `packages/knowledge/knowledge-router/src/memorix-store.ts:memorixPage` lists newest first (`ORDER BY rowid DESC`) because oldest-first order hid recent agent memories behind imported document chunks; its `view` argument filters `topicKey LIKE 'document:%'` only when the table has that column. `packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace.readExport` stats a graph export instead of allocating `maxGraphBytes` to measure it.

`packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace` registers `memorix_import_file` with the existing tool registry and filesystem. Reads resolve against the calling chat workspace, honor filesystem confinement and combine caller cancellation with plugin teardown; the panel and tool share document retention and provider read-back. `src/client/MemoryPage.module.css` sets native option colors and the active dark color scheme. The package `./types` export exposes declarations only, following `ui-settings-general`, so raw Client JavaScript with CSS imports is not published.

`packages/host/plugin-inventory/src/types.ts:HookInventoryReport`, `packages/experimental/hooks-codex/src/index.ts:apply`, `packages/experimental/hooks-claude-code/src/index.ts:apply`, `packages/host/plugin-inventory/src/index.ts:readPluginInventory`, and `packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection` publish loaded hook configuration through a synchronous collector, and Settings lists it with the enablement controls described below. The source file is not reread, disposal removes reports, and loaded status does not establish execution.

`packages/experimental/hook-protocol/src/inventory.ts:hookEnabled` is the single hook enablement rule used by both bridges (`runPoint`) and `describeHookHandlers`. A hook's identity is `hookKey` = `[event, matcher, command]` after substitution. A Session override wins; otherwise the hook runs only when the bridge's volatile `enabledHooks` names its key or contains `ALL_HOOKS` (`'*'`). Default-deny means a new or edited external hook has a new key and stays off. The wildcard is for operator-written compositions such as `snapshots/session/text-turn/cordis.yml`; Settings writes explicit keys only.

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection` lists only reports that carry `settingsNs` (`ctx.fiber.entry.options.id`), which only a mounted bridge sets; external file reports from `packages/host/plugin-inventory/src/hook-files.ts:readHookFiles`, including failed parses, are not controllable and are hidden. Toggles and descriptions write `enabledHooks` and `hookDescriptions` to that namespace through `remote.settings.mutate`; the Loader `entry.id` carries an `include/` prefix that settings rejects.

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:hookName` names a hook by its script basename after the last `/` or `\`, so a Windows command such as `node "C:\hooks\check.mjs"` shows as `check`. `HooksSettingsSection` uses `settingsNs` directly as the write namespace: a bridge that failed to load reports no handlers (`packages/experimental/hooks-codex/src/index.ts:apply` leaves `parsed` empty), so handler rows and their controls never appear without a loaded bridge.

`packages/api/session-controller/src/hook-overrides-projection.ts:installHookOverridesProjection` folds the log-only `hooks/session-overrides` event into the `hookOverrides` projection. `SessionController.listHooks` and `setHookOverrides` serve the composer `hooks` popup in `packages/client/ui-conversation/src/client/apply.ts`.

`packages/boot/plugin-manager/src/mcp-servers.ts:discoverMcpServers` reads Claude Desktop, Claude Code (top-level and per-project `mcpServers`) and Codex (`config.toml` `mcp_servers`); SSE servers are skipped because `dsh-mcp-client` speaks stdio and streamable HTTP only. `PluginManager.addMcpServer` appends a profile `insert` row with id `mcp-<serverName>`, `removeMcpServer` deletes that insert and any direct rows for the id, and enablement reuses `setPluginEnabled`.

`packages/knowledge/knowledge-router/src/index.ts:KnowledgeRouter` registers `/graphify` only when `config.graphify.cli.command` is a string. The `Config` schema fills `graphify.cli` with `{ args: [] }` even when no launcher is configured, so testing `cli !== undefined` registered a command that would run an undefined executable.

`packages/client/ui-memory-workspace/src/document-text.ts:documentText` keeps only text items from `getTextContent()`. Marked-content items exist only when `includeMarkedContent` is requested, which this call leaves off, so the filter is a type narrowing and never drops content.

`packages/client/ui-plugin-manager/src/client/McpServersSection.tsx:reason` turns a rejected list, discovery or change call into its message, using `String(error)` for values that are not `Error` instances, so a rejection from the transport layer is never shown as a blank alert.

`packages/llm/llm-pi-ai/src/catalog-supplement.ts:SUPPLEMENT` carries only the models the pinned pi-ai 1.3.0 catalog still lacks, transcribed from the OpenCode docs (`/docs/zen`, `/docs/go`), the `/models` listings and models.dev, snapshot `catalog-corrections.ts:OPENCODE_SNAPSHOT` (2026-10-14). Zen gets `gpt-5.3-codex-spark`; pi-ai 1.3.0 ships Zen `gemini-4-argon` and `cat-jam-free` and Go `gemini-4-argon-contributor` and `cat-jam-free`, so those four entries were deleted. The `deepseek` route carries `deepseek-v4-flash` with its 0.85.1 entry unchanged (prices 0.14 / 0.28): pi-ai 1.2.0 dropped the id, models.dev marks it deprecated and lists 0.15 / 0.6, and the harness defaults and tests still name it. `deepseek-v4-flash-vision-exp` is not carried: it is deprecated upstream, absent from 1.2.0, and named only by tests. A supplement for an id the installed catalog already carries is dead data, since the installed entry wins, so 1.2.0's entries were removed from it. A pi-ai `Model` accepts only text and image input, so audio, video and PDF modalities are dropped, and tiered long-context prices use the base rate. OpenAI-protocol models use `openai-responses` with `sessionAffinityFormat: 'openai-nosession'`, as the installed sibling routes do; the rest reuse the installed OpenAI-compatible `compat`.

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection` filters hooks with one search box over the source file, dialect, script name, event with matcher, command and description. A script group stays whole when any of its handlers match, so a group toggle still acts on every handler it names; the bulk Enable all and Disable all buttons are hidden while searching because they act on the whole file, including rows the filter hides. The source file and each command are printed as text instead of tooltips, which is how a user finds the file that defines a hook. `hooksEmpty` now says that only loaded hook bridges are listed, since external hook files are never shown on this page.

`packages/client/ui-memory-workspace/src/automation.ts:SECRET` covers provider tokens, GitHub PATs, Google API keys, AWS keys, PEM blocks, JWTs, Bearer values and `*KEY`/`SECRET`/`TOKEN`/`PASSWORD` assignments, including quoted JSON keys. `URL_USERINFO` redacts URL userinfo through a group-preserving replace so the scheme survives. The assignment alternative starts with `(?<![\w-])` after the optional quote: without that anchor V8 retries from every character of a long word run, and a 40 000-character unbroken run takes about 2.5 s instead of under 1 ms, because `scrub` runs on the full reply before clipping. The `[_-]key` alternative is kept so `STRIPE_KEY=` is redacted. The scrub is pattern-based, so `max_tokens=4096` is also redacted and unlisted credential formats pass through.

## MCP connection status and OAuth sign-in

`packages/mcp/mcp-client/src/status.ts:McpConnectionReport` is the truthful connection state of one HTTP or stdio MCP server: `connecting`, `connected` with its tool count, `auth-required`, or `failed` with the error. `packages/mcp/mcp-client/src/connection.ts:startConnection` answers the `mcp-client/inventory` event, and `packages/boot/plugin-manager/src/index.ts:PluginManager.listMcpServers` emits it and copies each report into `McpServerRow.connection`. Before this, a plugin whose fiber was active showed "Running" even when the server answered 401 and registered no tools.

`packages/mcp/mcp-client/src/connection.ts:startConnection` does not schedule reconnect attempts while a server needs sign-in: a 401 would repeat forever. The attempt settles as `auth-required` and restarts only when `credentials/record-updated` reports the server's grant record, which a completed sign-in writes. An established connection also drops to `auth-required` when its grant stops working: `startConnection` wraps the provider's `onUnauthorized`, and when that reports sign-in required (`oauth.ts:isAuthRequired`) `signInLost` closes the generation without scheduling a reconnect. The close waits one event-loop turn so the failing tool or resource request still rejects with the sign-in error the model reads. A refresh failure of any kind ends there, because the SDK falls back to a fresh authorization that `grantAuthProvider` turns into `AuthRequiredError`; only an unreachable authorization server leaves the connection as it was. `packages/client/ui-plugin-manager/src/client/McpServersSection.tsx:McpServersSection` re-reads the list every 1.5 s while a server is connecting and every 10 s while any enabled server reports a connection state, so a later loss of sign-in or connection shows without user action.

`packages/mcp/mcp-client/src/oauth-flow.ts:signIn` reuses the model-provider seams: `registerOAuthFlow` registers an `authorization` flow, tokens and the dynamic client registration live in a credential `grant` record (`oauth.ts:grantKey`), and the browser reaches it through the `authorization` Remote namespace. `listenForCallback` binds the redirect listener to `127.0.0.1` on the Harness host, so sign-in completes only when the browser runs on that same machine; a browser on another device cannot reach the callback.

`packages/mcp/mcp-client/src/oauth-flow.ts:offerSignIn` skips OAuth when the server config already carries an `Authorization` header (`oauth.ts:hasAuthorizationHeader`), in `headers` or `headerEnv`. A static token is then the only credential and a 401 is reported as `failed`, not `auth-required`.

`packages/client/ui-plugin-manager/src/client/McpServersSection.tsx:McpServersSection` sends the Headers field as `headers` in the profile patch row. Header values, including tokens, are stored in plaintext in the profile's `cordis.patch.yml`; the form hint says so, and `headerEnv` remains the way to keep a secret out of the file.

`packages/client/ui-plugin-manager/src/client/index.ts:apply` gives the MCP section its own `signInMcpServer` callback instead of reusing the Models page sign-in. A feature plugin may not import another plugin's component or value, so the section drives `remote.authorization.begin` itself, relays its notices, and treats a stream that ends after the user cancelled as settled rather than as an error.

## Provider filters in the model picker

## Model picker group headings

`packages/client/ui-model-selection/src/client/ModelSelect.module.css:.groupTitle` is not sticky because the menu material `--dsw-specific-menu` is translucent, so a sticky header let scrolled rows show through it, and no opaque token matches the material. Headings scroll with their rows.

## Model name cache

`packages/client/ui-model-selection/src/client/catalog.ts:ModelCatalogDirectory.nameFor` returns the last catalog name seen for an exact provider/model in this Host generation. Names are cached per Host generation so a selected model keeps its name while its provider is absent from a refresh; `directory.ts` copies the name into `retainedName`; the trigger falls back to it before the saved model ID, so the bare model ID (without its provider) appears only when no name was ever seen in this Host generation. The trigger's title and accessible name carry the full `provider/model` in that case (`ModelSelect.tsx:ModelSelect`).

## Unavailable session selection

## Ultracode model capability

`packages/llm/llm/src/model-capabilities.ts:ultracodeSupported` is the declaration: a constant set of exact model ids, independent of any provider route. It lives in the llm core rather than `packages/llm/llm-pi-ai` because the Claude Code provider must answer the same question without a route being registered; `packages/subagent/subagent-claude-code/src/index.ts:ClaudeCodeProvider.start` is a Claude Code CLI run that needs no pi-ai route at all, and a route is only registered once a profile configures it. `packages/llm/llm/src/model-capabilities.ts:claudeCliUltracodeSupported` adds the Claude CLI aliases (`opus`, `sonnet`, `haiku`, `fable`, each with and without `[1m]`) and the dated ids of the same models on that route only. Ultracode is a capability of the current Claude 5 family (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1), as in Claude Code, where it is the top level of the effort menu.

`packages/api/session-controller/src/commands.ts:SessionCommandController.setRunOptions` refuses to turn Ultracode on (a stored flag may be carried through an unrelated write) for a model that does not support it. `packages/api/session-controller/src/commands.ts:SessionCommandController.selectModel` clears a stored flag when the new model does not support it, so switching back to a capable model does not revive a flag the user left behind. Persisted flags on other models therefore load as off without a migration.

## Ultracode session toggle

`packages/api/session-controller/src/run-options.ts:installRunOptions` registers the `session:ultracode` system-prompt section at `packages/core/system-prompt/src/index.ts:SECTION_ORDERS` `ULTRACODE_POLICY` (550, between plan mode and team policy). Its text is empty unless `packages/api/session-controller/src/run-options.ts:ultracodeActive` holds, that is the Session's `runOptions` projection has `ultracode: true` and its model supports Ultracode, so a Session without Ultracode gets no instruction. While it is on, the instruction asks the agent to split substantive work into independent pieces, run them through the delegation tools that are listed (the subagent and workflow tools), and have a separate subagent try to refute each result before it is reported; with no delegation tool listed, the agent plans and checks the work itself. Presets mount the session's tools, so Ultracode cannot add a delegation tool to a running Session; the instruction is conditional on the listed tools for that reason. A Session `ultracode` value still maps to native ultracode for delegated Claude Code runs, as described below.

Delegation-tool coverage is a recorded limit, not a fix. In `packages/bundle/web-app/presets/*.patch.yml`, `tool-subagent` is enabled in `standard`, `cordis`, `economy`, and `ptc`; `tool-workflow` and `workflow-ptc` are enabled only in `standard` and `cordis`, and disabled in `economy` and `ptc`; `lean` and `minimal` mount neither. `packages/preset/agent-preset-registry/src/mount.ts:auditRows` skips disabled entries, so a disabled mount is absent from the Session. Delegation tools cannot be added per Session: a preset revision is shared by the Agents that select it (`packages/preset/agent-preset-registry/src/mount.ts:PresetMount`), `packages/preset/agent-preset-registry/src/index.ts:AgentPresetRegistry.mount` fixes an Agent's preset at creation, and `packages/core/tools/src/index.ts:ToolRuntime.restrict` can only hide globals. Giving `lean` or `minimal` delegation tools therefore needs a design decision (a different preset, or per-Session mounts), so it awaits sign-off.

`lean` and `minimal` use a `complete: true` persona with `includeRuntimeContext: false`. `packages/core/system-prompt/src/index.ts:SystemPrompt.assemble` keeps only the complete section and empties contexts, so `session:ultracode` is dropped there. The same text therefore also travels as the `ultracode_policy` prompt variable that `packages/api/session-controller/src/run-options.ts:installRunOptions` registers scope-aware, and `lean.patch.yml` and `minimal.patch.yml` reference it in the persona `prefix`, which a complete persona interpolates. On those presets the agent then plans and checks its own work, because no delegation tool is listed. A custom complete persona that omits the `{{ultracode_policy}}` reference drops the instruction silently.

## Claude Code run options

`packages/subagent/subagent-claude-code/src/index.ts:ClaudeCodeProvider.start` reads the delegating Session's `runOptions` projection on each run. An ultracode value is passed only when the run's model (the per-run model, else the configured one) is a current Claude 5 family model per `packages/llm/llm/src/model-capabilities.ts:claudeCliUltracodeSupported`; the run's model is what counts, not the Session's. A Session `ultracode` value overrides the optional Profile `ultracode`; `run.ts:claudeQueryOptions` sends a resolved `false` as flag setting `ultracode: false` so native settings cannot re-enable it, and sends nothing when neither is set; `fastMode` is sent as flag setting `fastMode` only when the Session set it. `Options.effort` comes only from the Session's `runOptions.effort`; the parent route's reasoning effort is never sent, so no effort is set unless the Session chose one.

`packages/subagent/subagent-claude-code/src/index.ts:mcpServerSchema` validates each custom agent's `mcpServers` against SDK 0.3.296 `McpServerConfigForProcessTransport` stdio, sse and http variants at plugin load. The SDK's `tools` policy fields stay optional. `sdk` entries are rejected because the provider passes no `Options.mcpServers`, so no in-process server exists for them to name. Each variant and each `tools` entry is built with `exactObject`, whose transform callback throws on keys outside the SDK variant's field set, so a misspelled optional field such as `header` or `alwaysload` fails at load instead of being ignored by the SDK. schemastery runs a transform callback on the stripped result and on the raw input; the raw pass is what sees unknown keys.

## Claude Code Ultracode setting

`packages/settings/settings/src/index.ts:SettingsForms.describe` publishes a Profile entry to Settings only when `packages/settings/settings/src/schema.ts:volatileForm` finds a `.volatile()` field, and `SettingsForms.write` accepts only volatile paths. The Claude Code Config declared none, so the `subagent-claude-code` namespace was never served and no Settings card could show or save `ultracode`. `packages/subagent/subagent-claude-code/src/index.ts:Config` now declares `ultracode` as `z.boolean().volatile()`, so the Loader commits a Settings edit in place (`vendor/loader/src/config/entry.ts:Entry._commitVolatile`), and `packages/subagent/subagent-claude-code/src/index.ts:ClaudeCodeProvider.start` reads `this.config.ultracode?.get()` on each run after the Session's `runOptions`.

The Config schema is unannotated because `z<Config>` pins a schema's input and output to one type, and a volatile output is a `Volatile<boolean | undefined>` reference, not a boolean input. `packages/subagent/subagent-claude-code/tests/real-product.spec.ts:realHarness` therefore types its `extra` argument with a plain `ultracode` boolean, which is the schema input.

`packages/client/ui-settings-subagent/src/client/index.ts:apply` registers `ClaudeCodeCard` into the Plugins page's `plugins.item` slot (id `subagent-claude-code`, order 31) only while `ctx.configForms.whileServed` sees that namespace served. `packages/client/ui-settings-subagent/src/client/claude-code-card-controller.ts:ultracodeField` stages the switch as `'true'` or `'false'` text and formats an absent value as `'false'`, so toggling on and back off before saving writes nothing and an unset field keeps its native-default meaning. `packages/client/ui-settings-subagent/src/client/ClaudeCodeCard.tsx:ClaudeCodeCard` offers **Reset to default** only while the user layer carries the field; otherwise it says Claude Code's own settings decide.

The provider is an optional bundle (`packages/subagent/subagent-claude-code/cordis.patch.yml`), so the card appears only after the user enables the Claude Code bundle on the Plugins page. Fast mode and effort have no Profile field: they are per-Session `SessionRunOptions` chosen in the composer, so Settings has no control for them.

## Other agent CLI skill roots

`packages/skill/skill-filesystem/src/index.ts:FileSystemSkillProvider.roots` scans the SKILL.md-compatible skill directories of other agent CLIs after the Claude roots, so a skill installed for Codex, OpenCode, Gemini CLI, Cursor, GitHub Copilot, or goose is visible without copying it. Each root exists only where the tool documents it:

- Codex: `codex-rs/ext/skills/src/host_roots.rs` scans repo `.agents/skills` (cwd up to the repository root) and `$HOME/.agents/skills`, both already scanned here, plus each config layer's `skills` folder: the project layer `<project>/.codex/skills` and the user layer `$CODEX_HOME/skills` (default `~/.codex/skills`), which the source keeps as a deprecated location for backward compatibility. Codex caches its bundled system skills in `$CODEX_HOME/skills/.system`, so the user-codex root skips `.system`. Sources: https://github.com/openai/codex/blob/main/codex-rs/ext/skills/src/host_roots.rs and https://learn.chatgpt.com/docs/build-skills (formerly https://developers.openai.com/codex/skills).
- OpenCode: project `.opencode/skills` and global `~/.config/opencode/skills`. The global directory comes from `xdg-basedir`, so `opencodeHome` defaults to `$XDG_CONFIG_HOME/opencode` when that variable is set. `OPENCODE_CONFIG_DIR` is an extra directory loaded after the global one, not a relocation, so it is not the default; deployments add it through `customSkillDirs`. The `metadata` entry `opencode/autoinvoke: "false"` keeps a skill out of automatic invocation. Sources: https://opencode.ai/docs/skills/ and https://opencode.ai/docs/config/.
- Gemini CLI: workspace `.gemini/skills`, user `~/.gemini/skills`; `GEMINI_CLI_HOME` is the parent of `.gemini`. Sources: https://geminicli.com/docs/cli/skills/ and https://geminicli.com/docs/reference/configuration.
- Cursor: `.cursor/skills` and `~/.cursor/skills`; Cursor also lists `.codex/skills` and `~/.codex/skills` as compatibility roots. Source: https://cursor.com/docs/context/skills.
- GitHub Copilot: project `.github/skills`, personal `~/.copilot/skills`; `COPILOT_HOME` replaces `~/.copilot`. Sources: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-skills and https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference.
- goose: project `.goose/skills`, which the docs call a legacy location that is still discovered. The documented user location is the shared `~/.agents/skills`, and the other user folders are unnamed platform-specific config directories, so there is no user-goose root. Source: https://goose-docs.ai/docs/guides/context-engineering/using-skills.

The ranks 232-242 (project) and 560-580 (user) keep every foreign root below `.agents`, `.dsh`, and `.claude` and above the runtime (250) and bundled (600) ranks, so a skill shared through `.agents/skills` never loses to a tool-specific copy.

`packages/skill/skill-filesystem/src/index.ts:foreignModelInvocable` maps the two foreign invocation dialects onto `modelInvocable`: Codex's `agents/openai.yaml` `policy.allow_implicit_invocation` and OpenCode's `metadata["opencode/autoinvoke"]`. The explicit `disable-model-invocation` key wins, and a non-boolean value throws into the existing invalid-invocation path so the skill is dropped with a warning rather than silently becoming model-invocable. The sidecar is read on every parse, so a body or frontmatter edit refreshes it; the watcher only fires on `SKILL.md`, so editing `openai.yaml` alone waits for the next catalog refresh.

Tests pin every home through `otherAgentHomes` in `packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts` and the matching fixtures (`apps/web/tests/scaffold.ts`, `apps/cli/tests/profiles/headless/tests/fixtures/cli.patch.yml`, `scripts/gen-tool-catalog.ts`); a test that mounts the provider with default roots would otherwise read the developer's real `~/.codex`, `~/.cursor`, and similar directories.

`packages/subagent/subagent-codex/README.md` records that the Codex child discovers skills natively and is not given the harness skill registry. The pinned app-server 0.153.4 does expose `skills/extraRoots/set` (`{ extraRoots: AbsolutePathBuf[] }`, process-wide, followed by `skills/changed`; confirmed with `codex app-server generate-ts`), but it only adds whole directories. Forwarding a harness root would expose every skill in it, including names the harness resolved to a higher-ranked root, and Codex does not merge same-name skills, so the child would see duplicates; flat `<name>.md` skills are not Codex-loadable. Wiring it needs a per-run root that holds only the winning bundles.

## Settings search, grouping and save status

`packages/client/ui-settings/src/client/settings-directory.ts:SettingsDirectory` is a service rather than an extension of the `settings.section` slot because the slot registers only an id, an order and a label, and ui-slots has no description or group option. Packages therefore register searchable entries beside their sections, and the shell reads them through `SettingsDirectory.search`. The client bundle purity gate forbids cross-plugin value imports, so the directory carries only strings; a registered `when()` hides an entry whose feature is not loaded (for example the Link row without the built-in browser). `search` requires every query word and scores a label prefix 5, a later label hit 3, keywords 2 and description 1, so the page name beats an incidental description match.

`packages/client/ui-settings-general/src/client/search-entries.ts:generalSearchEntries` indexes the General rows from `index.<stem>.*` locale keys. The rows themselves render in other packages (for example Appearance in ui-theme), so this file duplicates their wording as search metadata only; changing a row's label there does not change what search shows until the matching key here changes. Keywords are English in both dictionaries so a query works in either language.

`packages/client/ui-settings-general/src/client/GeneralSection.tsx:groupGeneralItems` groups the registered `settings.general.item` ids under headings and sends any id it does not know to Advanced. Each row is rendered with `renderSlot('settings.general.item', {}, { only: id })` inside a `data-settings-entry` wrapper so search can scroll to it and flash it; the slot's own `display: contents` wrapper cannot be scrolled.

`packages/client/ui-settings-general/src/client/SettingsRoot.tsx:SettingsPanel` clears the query on Escape through `preventDefault` because `useModalLayer` ignores a document Escape that was already default-prevented; a second Escape then closes the dialog. The section container is keyed by the active section so changing page resets the scroll position, and it stays mounted but hidden while a query is typed so unsaved drafts on the open page survive a search. Below 640px the rail becomes a column with a horizontally scrolling strip, because the fixed 188px rail left about 184px for content at 420px wide.

`packages/client/ui-settings/src/client/save-status.ts:SaveStatusTracker` wraps the single enqueue point of `config-form.ts:ConfigFormController`, so every Host write of every shared form is counted, with no per-page wiring. A batch settles to failed if any write failed, and the saved and failed notices clear after 2.5 s and 8 s.

`packages/client/ui-settings/src/client/settings-directory.ts:SettingsDirectoryLink` lets an entry lead outside the Settings dialog. `register` rejects an entry with both or neither of `section` and `link`. `ui-settings-general/src/client/SettingsRoot.tsx:SettingsPanel` closes the dialog before calling `open`, so the destination is not hidden behind the modal.

`packages/client/ui-plugin-manager/src/client/index.ts:apply` registers one search entry for the Plugins page and one per `plugins.item` from `configLedgerSource`, inside the `main` registration so `open` can drive the page's navigation store. It re-registers only when the ledger snapshot changes. Entries carry the item title only, because the page never names a configurable plugin, so a field word such as 'timeout' does not find a plugin page yet.

`packages/client/ui-settings-models/src/client/ModelsSection.tsx:ModelsSection` shows `providersLoading` only while the status is not ready and no rows are known, so a refresh of an already listed directory does not flash it.

## web-transport-chat

`packages/client/hmr/src/client/index.ts:apply` elects one leader tab per browser with `navigator.locks.request` on `LEADER_LOCK`. Only the leader opens the `/plugins/events` EventSource. It applies each frame locally and posts the same frame on the `CHANNEL` BroadcastChannel, and the other tabs apply channel frames without opening a connection. The point is to keep Chromium's six HTTP/1.1 sockets per host free for RPC when every tab would otherwise hold a long-lived SSE stream.

`packages/client/hmr/src/client/index.ts:apply` posts `{ type: 'hello' }` when a tab starts. The leader closes and reopens its EventSource on hello, so the Host sends a fresh full graph and the leader relays it to every tab. This covers a joining tab that missed the graph sent when the original connection opened. The channel never caches a graph, so a joiner cannot receive a stale revision; a duplicate graph is a no-op because `packages/client/modules/src/client/entries.ts` reconcile compares revisions.

`packages/client/hmr/src/client/index.ts:apply` falls back to one EventSource per tab when `navigator.locks` or `BroadcastChannel` is missing. Plain-HTTP LAN pages are not secure contexts and take this path. `packages/client/hmr/tests/transport.client.spec.ts:FakeLocks` stubs the lock manager and channel because Node 22 has no `navigator.locks`.

`packages/api/gateway/src/client/index.ts:ClientRemoteService.invoke` exempts a method whose descriptor declares `cancellation` from the unary deadline. Such methods (`directoryPicker/pick` opens the Host's native OS chooser, and an upload, office render, transcription or slash-command execute also take a signal) keep their lifetime with the caller; aborting the chooser is what closes it, so a Client deadline would close a chooser the user is still using. Accepted gap: signal-taking reads such as `session/list` and `session/page` get no deadline.

`packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace` declares `importDocument(filename, data, signal?)`. Extraction and the Memorix chunk import can run longer than the 30 s unary deadline, and the Host keeps importing after a Client deadline, so a falsely failed upload would invite a duplicate re-import. The trailing signal makes the generated descriptor cancellation-aware, which exempts it from the deadline; the Host still stops when its own lifetime aborts. `packages/typert/generator/tests/memory-workspace-descriptor.spec.ts` checks the generated descriptors on both faces. Open question for the lead: whether `cordis-host-runner` `invoke`/`runHostHalf` need the same treatment, since user handlers there run without a signal.

`packages/api/gateway/src/client/index.ts:ClientRemoteService.invoke` races the carrier call against the per-call deadline signal instead of trusting the carrier to settle. A carrier may ignore its abort signal, and the race keeps the error branch bounded. The race uses only the per-call deadline signal, not the mount lifetime, so each call's listener is released with its controller. The deadline folds into `gateway/internal` through `packages/api/gateway/src/client/failures.ts:deadlineFailure`, reusing the branch a carrier throw already folds into because the Remote failure vocabulary has no timeout code.

`packages/client/ui-tool/src/client/tool/models/tool-call-model.ts:toolViewKey` resolves a tool's presentation key in this order: an explicit title key, then any `_inspect` name, then the `subagent_` prefix. Every `subagent_<provider>` instance therefore shares the `subagent` keyed view, title, receipt and reply details. The `subagent_` prefix matches the one `packages/client/ui-chat/src/client/conversation-nodes/process-activity.ts:processActivity` groups delegation calls by. Unlike that grouping, `_inspect` names keep their own key, so an inspection tool is never presented as a delegation.

`packages/client/ui-tool/src/client/tool/models/control-details-model.ts:controlDetails` takes the provider from `packages/client/ui-tool/src/client/tool/models/tool-call-model.ts:subagentProvider`, which replaces `_` with `-` in the suffix so the label matches preset ids such as `claude-code`. It is a display label, not a lookup key, so a provider id with a literal underscore displays with hyphens.

`packages/client/ui-chat/src/client/chat/ApprovalCommand.tsx:describeApproval` shows what a correlated Tool call will do, because `args.command` alone left write, edit and run_code approvals without context. Its branches run in order: command, then a write's path with the first 40 content lines, then an edit's path with `-`/`+` lines, then run_code `code`, then pretty-printed arguments capped at 4096 characters. Content beyond 40 lines and arguments beyond the cap end with `…`. The headline above the detail is the model's reason, rendered by `packages/client/ui-approval/src/client/ApprovalPanel.tsx`. Labeling it as the model's reason belongs to ui-approval and was not done from ui-chat.

`packages/client/ui-chat/src/client/chat/MessageItem.tsx:TurnEndAction` submits Retry and Continue through the composer (`setDraft` then `submit`) instead of `session.prompt`. The composer path gives a resend the same echo, slash-command adjudication and single submit path as typed input, so it cannot bypass command handling or create a second submission route. The action is disabled while the composer holds a draft or attachments rather than overwriting them, because overwriting would silently discard unsent text.

## delegation

`packages/subagent/subagent/src/out-of-process.ts:resolveParentSandboxMode` lives in dsh-subagent rather than in the product providers because `subagent-claude-code` and `subagent-codex` do not depend on `@deepseek-ai/dsh-sandbox-policy`. dsh-subagent already declares that package as an optional peer and reads `ctx.get('sandboxPolicy')` opportunistically. A composition without a sandbox policy returns `undefined`, meaning the host is unconfined, so no sandbox clamp applies.

`packages/subagent/subagent/src/out-of-process.ts:boundedProgress` keeps its one-line window in the closure of each sink, so every request has its own budget. A line that falls inside the window is dropped, not queued. Truncation counts code points through `Array.from`, so a surrogate pair is never split.

`packages/subagent/subagent/src/out-of-process.ts:runTimeLimit` settles a timeout as a provider failure by rejecting `expired`, not by only requesting cancellation. A bare cancel would reach settlement as `aborted`, the same as a user kill. `timedOut()` lets the caller tell the two apart. `expired` carries a no-op catch so a run that finishes first does not leave an unhandled rejection behind.

`packages/subagent/subagent/src/index.ts:SubagentRuntime.start` reserves a slot in the delegating parent's `maxActiveSubagents` pool before `provider.start`, because the pool belongs to the continuation registry and only the service sees every one-shot start. The slot is released on result settlement, not on handle disposal, so a finished one-shot run frees capacity even if its holder never disposes it. A failed `provider.start` releases the slot immediately, since no run exists to settle.

`packages/subagent/subagent-claude-code/src/sdk-messages.ts:assistantErrorDetail` reads `resetsAt` as seconds below `1e12` and as milliseconds otherwise. The Agent SDK documents no unit for `SDKRateLimitInfo.resetsAt`, and epoch milliseconds cross `1e12` in September 2001, so the guard separates the two readings for any real reset time. A value whose `Date` is invalid falls back to the bare error code, so an out-of-range reset cannot throw from the failure path.

`packages/subagent/subagent-claude-code/src/run.ts:consumeClaudeQuery` keeps only the last assistant message's `error`. A later assistant message without an error clears it, so a recovered turn cannot leave a stale rate-limit classification on a later failure. The latest `rate_limit_event` with a numeric `resetsAt` is kept separately, because the reset time arrives before the error it explains.

`packages/subagent/subagent-claude-code/src/run.ts:successfulResult` attaches the observed assistant detail only when the reported category is the one that error maps to. A `limit` subtype such as `error_max_turns` therefore keeps `limit` without an unrelated authentication detail, while a non-limit subtype yields to a more specific observed category.

`packages/subagent/subagent-claude-code/src/sdk-messages.ts:toolUseProgressLines` emits the raw file path, command, or pattern without truncation because it is advisory input to the shared sink. `packages/subagent/subagent/src/out-of-process.ts:boundedProgress` owns the rate limit and the 120-code-point cap, so the Claude provider does not duplicate that policy.

`packages/subagent/subagent-claude-code/src/run.ts:startClaudeCodeRun` excludes a timed-out run from `cancelled()` (`controller.signal.aborted && !limit.timedOut()`). `settleRunResult` maps any local cancellation to a bare `aborted` stop reason with no diagnostic, so a timeout that only requested cancellation would look like a user kill. The `limit` failure rejects the attempt instead, and `settleRunResult` reports `error` with the `exceeded timeoutMs` detail. The timer is armed after the query and child are published and cleared when the attempt settles, so SDK and CLI startup stay outside `timeoutMs`.

`packages/subagent/subagent-claude-code/src/index.ts:sandboxedPermissionMode` clamps to the parent's file sandbox rather than trusting the Profile. A read-only parent forces `plan` whatever the configured mode, because `acceptEdits` accepts file edits outright and `dontAsk` still honors native allow rules that can permit writes. A workspace-write parent downgrades `bypassPermissions` and `auto`, because Claude Code's `auto` classifier can approve a Bash command or edit outside the workspace with no human in the loop. The function is generic over the SDK `PermissionMode`, not the five provider modes, so an agent's `default` passes through the type check and the clamp never needs an `as` cast. The clamp is logged and appended to the failure diagnostic with the configured and effective modes.

`packages/subagent/subagent-claude-code/src/index.ts:sandboxedAgents` applies the same clamp to Profile `agents`. The provider-level clamp alone is not enough, because an agent's own `permissionMode: 'bypassPermissions'` is sent to the SDK independently of the provider mode, so the agent map is clamped with the same function.

`packages/subagent/subagent-claude-code/src/run-options-projection.ts:inheritedRunOptions` walks at most `MAX_RUN_OPTION_HOPS` (8) parent hops and returns the first non-null projection. A child Session, such as a subagent spawned under an ultracode parent, has no `runOptions` of its own until the user changes one, so reading only the delegating Session dropped the parent's toggle. The bound stops a malformed or cyclic chain from walking forever, and an unresolvable parent id ends the walk with `undefined`.

`packages/subagent/subagent-codex/src/permission.ts:codexThreadPermission` forces `approve-for-me` to `approvalPolicy: never` with `sandbox: read-only` and no reviewer under a read-only parent. That mode routes approval requests to Codex `auto_review`, which could approve an escalation out of the sandbox, so removing the reviewer removes that path. A workspace-write parent forces every allowed mode to `approvalPolicy: never` with `sandbox: workspace-write` and no reviewer, so `never` now sends the sandbox explicitly under that parent.

`packages/subagent/subagent-codex/src/permission.ts:codexThreadPermission` Codex `auto_review` can approve an escalation out of any sandbox, so a `read-only` or `workspace-write` parent drops the reviewer.

`packages/subagent/subagent-codex/src/permission.ts:codexThreadPermission` refuses the bypass mode under any parent that is not `danger-full-access`, with `PARENT_SANDBOX_MISMATCH`. The mode sets `danger-full-access` itself, so clamping its sandbox down would silently contradict the Profile. The throw runs before the app-server spawns, so a refused start leaves no process behind.

`packages/subagent/subagent-codex/src/run.ts:startCodexRun` (timeout excluded from `cancelled()`) arms `runTimeLimit` only after publication, so app-server startup stays outside `timeoutMs`. Expiry rejects the attempt with a `limit` failure whose detail is `exceeded timeoutMs (N ms)`, then requests the local cancel. `cancelled()` is `runAbort.signal.aborted && !limit.timedOut()`, because `settleRunResult` maps any local cancellation to a bare `aborted` with no diagnostic; without the exclusion a timeout would look like a user kill. The timer is cleared in the attempt's `finally`, so a run that finishes first leaves no timer behind.

`packages/subagent/subagent-codex/src/wire.ts:codexProgressLine` emits its line in `handleNotification` before the `agentMessage` filter, so command and file-change items reach `onProgress` regardless of answer selection. A declined command or file change returns earlier through `recordDeclinedItem` and emits no line, because a declined item is a permission fact, not work the child did. The function returns `undefined` for any other item shape and never throws, so a malformed progress item cannot fail the turn.

`packages/subagent/tool-subagent/src/index.ts:apply` routes the provider's `onProgress` into `job.updateProgress` only in the one-shot background starter. The line is advisory: the next line replaces it, and settlement clears it. A line that arrives after settlement is dropped by `packages/jobs/jobs-local/src/index.ts` with a warning, so a late provider event cannot resurrect a finished job's row. Foreground runs leave `onProgress` unset because the tool call itself is the output surface, so no progress has anywhere to show.

`packages/subagent/subagent/src/index.ts:SubagentRuntime.activeSubagentLimit` exposes the configured `maxActiveSubagents` so composed fan-out such as workflow `parallel()` can cap its concurrency to the pool. Without it a fan-out wider than the pool would have its extra one-shot starts rejected with `ACTIVATION_LIMIT_REACHED`, and a throwing thunk becomes `null` in `parallel()`. The workflow layer owns the cap, so the rejection never reaches its members.

`packages/subagent/subagent-codex/src/index.ts:CodexProvider.start` sets the sandbox note only when the clamped `thread/start` fields differ from the unclamped Profile mode, compared by `JSON.stringify`. Under a workspace-write parent every allowed mode changes its fields, so the note names that clamp for `approve-for-me` and `never` alike. A `danger-full-access` parent or no sandbox policy changes nothing and adds no note.

`packages/subagent/subagent-claude-code/src/index.ts:narrowedAgentNotes` names each Profile agent whose mode the parent sandbox narrowed, and the provider-level note joins them with `; `. The provider-level comparison alone missed a case where only an agent's `bypassPermissions` was downgraded, so that clamp was applied without any log or diagnostic.

## hooks-tools

`packages/experimental/hooks-claude-code/src/index.ts:runPoint`: a `continue: false` result cancels the agent's active activity with the `hook` cause and `keepInbox: true`, so queued user input survives the halt. The cancel runs before the point maps its decision, so a PreToolUse halt denies the call while the turn aborts. Without an agent, `opts.agent?.` skips the cancel and the point's own decision applies alone.

`packages/experimental/hooks-claude-code/src/index.ts:agent/turn-stopping`: a Stop result with `continue: false` returns without steering. A steer issued after the cancel would stay in the kept inbox and wake the agent on a later turn.

`packages/experimental/hooks-claude-code/src/index.ts:stopPayload`: `stop_hook_active` reports whether this turn was already force-continued. The count lives in `packages/experimental/hook-protocol/src/stop-guard.ts:createStopLoopGuard`, keyed by agent identity and turn number. A steered continuation stays in the same turn, so the count holds until the turn ends. It must not reset on pre-step, because the bridge's own steer re-enters the loop as pre-step input.

`packages/experimental/hooks-claude-code/src/index.ts:apply`: `maxForcedStops` (default `DEFAULT_MAX_FORCED_STOPS`, 3) bounds Stop continuations per turn, so an unconditionally blocking Stop hook cannot loop forever. Hitting the cap logs a warning and lets the turn end.

`packages/experimental/hook-protocol/src/matcher.ts:HOOK_TOOL_ALIASES`: DSH tools use lowercase names while Claude Code hooks match Claude's names. Aliases apply only to the matcher subject and the payload `tool_name`. The DSH file, write and edit tools already use Claude Code's argument keys, so `tool_input` passes through unchanged. `str_replace_editor` has no alias because one `command` argument covers several actions that map to different Claude Code tools.

`packages/experimental/hooks-claude-code/src/index.ts:preToolPayload`: the hook payload carries the Claude Code tool name from `hookToolName`, so a hook never receives the DSH name for a tool that has an alias.

`packages/experimental/hooks-codex/src/index.ts:preToolPayload`: Codex's shell payload is `{ command }`, and only shells are aliased. Codex aliases `pwsh` to `Bash` as well as `bash`, because the Codex hook payload is shell-shaped and has no PowerShell name. Claude Code keeps `pwsh` as `PowerShell`.

`packages/experimental/hooks-codex/src/index.ts:runPoint`: the same `continue: false` cancel as the Claude Code bridge, with `keepInbox: true`. A UserPromptSubmit halt rejects the prompt and a PreToolUse halt denies the tool. A Stop halt ends the turn without steering, so the steer that would wake the agent later never happens.

`packages/experimental/hooks-codex/src/index.ts:apply`: the Codex Stop guard uses the same `maxForcedStops` cap and `createStopLoopGuard` count as the Claude Code bridge. Each bridge plugin instance builds its own guard in `apply`, so if both dialect bridges are mounted they count separately.

`packages/fs/tool-fs-search/src/glob.ts:buildGlobCommand`: `glob` respects ignore files and prunes `node_modules` by default, and `includeIgnored: true` restores `--no-ignore`. The default argv keeps `--sort=modified`. Mtime ordering is not redone in process with `fs.stat`, because ripgrep runs through `ctx.subprocess`, which may be sandboxed or remote, so a host-side stat would read the wrong filesystem.

`packages/fs/tool-fs-search/src/glob.ts:buildGlobCommand`: the `--glob=!**/node_modules` prune matches during traversal only. When the search root is at or inside `node_modules`, the bare glob never matches the root-prefixed paths, so an explicit root there still lists its files. This matches the VCS contents-glob reasoning in `GLOB_VCS_EXCLUDES`.

`packages/fs/tool-fs-search/src/glob.ts:patternFilter`: positive ripgrep overrides beat ignore files, so a slashless pattern (after any leading `**/`) goes through a `dshglob` type filter, which ignore rules still prune. A pattern with a separator stays an override. An override that matches the ignored directory itself (an unanchored `*`, which the old argv passed as `--glob=*`) re-includes its files, so the type form is needed for slashless patterns; a separator pattern such as `build/**/*.ts` was probed and did not re-include them. The empty name, a colon and a leading `!` also keep the override, because the type form rejects the first two and reads the last as a literal.

`packages/fs/tool-fs-search/src/search-core.ts:runRipgrep`: a timed-out `glob` throws `SEARCH_ABORTED` with no partial stdout, so the model is told to narrow `path` or `pattern` instead of receiving partial paths.

`packages/experimental/hook-protocol/src/matcher.ts:matchesHookSubject`: a matcher passes when it matches either the raw DSH name or the dialect alias for the active mode, so configs written for Claude Code or Codex fire unchanged. Session sources, `general-purpose` and the empty string are not in the alias table, so one helper serves every hook point and each bridge changes only its `runPoint` call.

`packages/shell/tool-bash-persistent/src/index.ts:TIMEOUT_STATUS_MARKER`: only the deadline signal is observed, so the timeout result no longer claims a possible OOM. The model cannot change the timeout, so the message tells it to run long commands in the background and poll their output instead.

`packages/boot/plugin-manager/src/tools.ts:apply`: list actions are read-only and need no approval prompt. Mutations validate their required arguments before `approve`, so a malformed call never prompts, and each approval summary names the change (for example `Install bundle X`). The approval reason carries no JSON argument dump.

`packages/client/ui-memory-workspace/src/automation.ts:scrub` runs `URL_USERINFO` before `SECRET`. The URL pattern keeps the scheme and host and replaces only the `user:password@` part. `SECRET` runs after it, and its PEM alternative spans newlines, so `scrub` must replace secrets before the whitespace collapse. Otherwise a multi-line key block is flattened before it can match.

`packages/client/ui-memory-workspace/src/automation.ts:SECRET` is pattern-based with no entropy check. Its generic `KEY`/`SECRET`/`TOKEN`/`PASSWORD` assignment alternative is deliberately broad, so it also redacts harmless assignments such as `max_tokens=4096`. `KEY` matches only after an underscore or hyphen (`[_-]key`), so bare prose such as `key: value` is not redacted while `STRIPE_KEY=...` is. That over-redaction is accepted because a leaked credential in a saved memory is worse than a redacted config value. The class list is in `packages/client/ui-memory-workspace/README.md` under Known Limitations.

## llm-reliability

`packages/compaction/compaction-basic/src/region.ts:selectCompactableRange`: the optional `maxPrefixTokens` bound moves the span end back over balanced cuts until the summarizer prefix fits. Overflow recovery used to select the whole history (`retainTokens` 0), so its summarizer request was larger than the request that had just overflowed and could never succeed on multi-unit history. The fixed part of the prefix is the off-surface overhead (`totalTokens - surfaceTokens`, tools and header pricing) plus the system head at surface node 0, which stays outside the span.

`packages/compaction/compaction-basic/src/summarizer.ts:summaryPrefixLimit`: the bound is the target window minus the summary cap, scaled by 0.9 for heuristic pricing error, minus the price of `COMPACTION_INSTRUCTION`. A window no larger than the summary cap yields no bound, which keeps the previous behaviour; a bound computed from such a window would be negative and disable recovery.

`packages/compaction/compaction-basic/src/index.ts:BasicCompactionEngine.compactIfNeeded`: the overflow path reads the window from `session.requestContext()`, the record the loop writes before the overflowing request, capped by `maxContextWindow`. The pressure path uses the resolved `spec.contextWindow`. Manual `compactNow` stays unbounded because the idle path has no cheap routed window. Recovery proceeds chunk by chunk: each overflow retry summarizes the next balanced head chunk, and the prior-checkpoint merge rule in `COMPACTION_INSTRUCTION` folds the earlier summary in.

`packages/compaction/compaction-basic/tests/compaction-loop-repro.spec.ts:windowedOverflowHarness`: pressure measures only the surface before the step starts, so the pending user message is not in its total. The pressure case therefore grows the surface through the previous turn's answer (the harness `answer` argument), and its window check uses the adapter's request size, which includes the summary cap, matching the `summaryPrefixLimit` bound. Removing the prefix limit from the pressure call of `compactIfNeeded` fails it at a 4268-token summary request.

`packages/llm/llm-pi-ai/src/stream.ts:mapStopReason`: pi-ai's overflow check flags any `stop` whose input exceeds the window, so a catalog `contextWindow` below the provider's real limit used to discard a completed answer as `CONTEXT_WINDOW_EXCEEDED`. Usage above the window now maps to that code only for a completion with no non-empty text or tool call, or a zero-output `length`. `toStreamChunks` reports a kept over-window answer through `onUsageAboveWindow`, and `packages/llm/llm-pi-ai/src/index.ts:apply` logs it once per route so the catalog gets corrected.

`packages/llm/llm-pi-ai/src/stream.ts:classifyPiAiError`: every Codex WebSocket drop (`WebSocket error`, `WebSocket closed <code>`, `WebSocket stream closed before response.completed`) is `TRANSPORT`, because the wire failed mid-response. Close 1009 (message too big) is `INVALID_REQUEST`, because resending the same body cannot succeed.

`packages/compaction/compaction-basic/src/index.ts:BasicCompactionEngine.skipPressureStep`: a failed automatic pressure attempt used to re-run the summarizer on every step of a turn against an unchanged surface, so one outage cost one summary request per step. `recordPressureFailure` stores `2^failures` skip steps (capped at 32) keyed to the surface `replaceGeneration`; a replacement invalidates the record. Success in the `agent/pre-step` listener and idle clear it. `TargetPressureConfigError` and aborted turns are not counted, because they have their own warn-once path or are cancellation.

`packages/compaction/compaction-basic/src/summarizer.ts:summarizeWithLlm`: the summarizer calls `ctx.llm.stream` directly, so no llm-retry policy covers it. One retry on `TRANSPORT`, `TIMEOUT` or `SERVER` (`TRANSIENT_SUMMARY_CODES`) absorbs a single dropped connection. The retry is skipped for aborted signals and for every other code, which keeps a rejected request from being resent.

`packages/llm/llm-retry/src/index.ts:apply` (`recover`, `NORMAL_RETRY_AFTER_CAP_MS`): normal mode honours a provider `Retry-After` up to `max(policy.maxDelayMs, 120 s)` and delegates to the next handler above that. It is a constant rather than a policy key, because `ResolvedRetryPolicy` lives in `dsh-llm` and a new key would fan out into every provider schema. Always mode keeps the `policy.maxDelayMs` cap, so its over-cap behaviour is unchanged.

## sidebar-search-quota

`packages/bundle/web-app/cordis.patch.yml:session-query-sqlite`: the web bundle uses a per-profile cache path, because the session-query-sqlite README says one service in one process owns a derived-index path, and Desktop and dev:web share one home. The sidebar footer for disabled search was not added: README:64 promises no warning on a failed content search, and session-controller `list.ts` rewraps every search failure, including the disabled code, as gateway/internal.

`packages/client/ui-workspace/src/client/tree.ts:deriveGroups`: attention counts over all visible members, with the same precedence as `rows/SessionStatus.tsx:sessionStatuses`. `rows/SessionTree.tsx:subtreeAttention` rolls up collapsed descendants.

`packages/client/ui-workspace/src/client/QuickSwitcher.tsx:QuickSwitcher`: the defaultPrevented guard means Desktop Mod+K (bound to `session.search` in `shortcuts.ts`) no longer also opens the switcher, because the shortcut service's window keydown listener (`packages/client/shortcuts/src/client/dom.ts`) runs first and consumes the key. Moving the switcher into the shortcuts registry is the follow-up.

`packages/api/quota-controller/src/providers.ts:createDeepSeek`: the provider id matches the LLM route `deepseek-official`, so `listProviders` merges the two DeepSeek rows into one.

`packages/client/ui-provider-quota/src/client/ProviderQuotaAction.tsx:ProviderQuotaAction`: Escape calls `preventDefault`, so the global `approval.reject` and `response.stop` Escape shortcuts stay idle while the Usage popover is open.

`scripts/dev-web.ts:pollNotice`: polling is opt-in. `pnpm run dev:web --poll` replaces the old default. There is no `dev:web:poll` script, so the pinned set in `verify-application-entrypoints` is unchanged.

## Subagent capacity and long-running Remote calls

`packages/workflow/workflow-ptc/src/index.ts:PtcWorkflowEngine.start`: each run's `maxConcurrentAgents` is the configured value (or the CPU-derived default) capped by `subagents.activeSubagentLimit()`, sampled at run start. Every one-shot `agent()` holds one slot of the parent's `maxActiveSubagents` pool, and a start at capacity rejects with `ACTIVATION_LIMIT_REACHED`. The workflow treats that rejection as a fatal `AGENT_START`, so an uncapped `parallel()` fan-out would fail the whole run instead of one member.

`packages/workflow/workflow-ptc/src/guest.ts:runWorkflowGuest`: progress is bounded before the PTC control-message limit is consulted (finding 283). One batch is in flight; later events queue and `flush` sends at most 256 events or 65,536 serialized characters per control call, so a burst becomes several frames instead of one oversized frame. The queue holds at most 4,096 events or 1,048,576 serialized characters; past that, `phase` and `log` narration is dropped and counted, and the next flush appends one `N progress events dropped` log event. `agent-start` and `agent-end` are never dropped because `maxTotalAgents` bounds them. A `log` message over 8,192 characters is truncated. Sizes count characters of the event JSON, a conservative proxy: the default `maxMessageBytes` is 128 MiB, and a deployment that lowers it far below 64 KiB can still reject a frame. An `agent()` label or phase string is not truncated.

`packages/workflow/workflow-ptc/src/runtime.ts:WorkflowExecution.contain`: a failed helper promise (`agent`, `parallel`, `pipeline`) the script never observes fails the run (finding 280). `contain` keeps an internal consumer so a dropped promise cannot become an unhandled rejection, records whether the helper rejected, and overrides the promise's own `then` so any script-side `await`, `.then`, `.catch`, `.finally` or `Promise.all` marks it observed (a host-realm promise awaited from the script's realm is resolved through `then`). `parallel` and `pipeline` await thunk results inside the host realm, which does not call `then`, so they mark the result observed through `WorkflowExecution.observe`. `WorkflowExecution.drive` checks after the script promise fulfils: a helper that rejected and was never observed turns the result into an `error` run that carries the helper's error code (or `RUN_FAILED`); a helper that is still pending at that point is not awaited and its later failure is not reported, because the host disposes it on settlement. An explicitly caught failure (`try { await agent(1) } catch {}`) stays `completed`; an ordinary child failure still resolves to `null` and is not a helper failure.

`packages/workflow/workflow-ptc/src/host.ts:PtcWorkflowRun.disposeChild`: a child Activation whose disposer throws or rejects no longer disappears into a log line (finding 281). The binding still acknowledges, so a failing disposer cannot wedge the guest or the settlement, and the child is still dropped from the tracking map. The failure is also recorded as `child <childId> (call <callId>): <rendered error>` and `PtcWorkflowRun.drive` attaches the list to the settled result as `cleanupFailures`, alongside the primary outcome (`completed`, `error` or `cancelled`) rather than replacing it. `PtcWorkflowEngine.start` copies it onto the `workflow/end` payload, and `packages/workflow/tool-workflow/src/index.ts` shows it in the foreground output and the background job detail. A failed disposer does not prove the child is still running, so the run is not failed. There is no retry: the record is dropped after one attempt and the identity string is the only handle kept.

`packages/workflow/workflow/src/types.ts:WorkflowResult.cleanupFailures` and `packages/workflow/workflow/src/types.ts:WorkflowResultInfo.cleanupFailures`: optional list of child cleanup failures reported beside the outcome; absent when every child disposed cleanly. Each entry is `child <childId> (call <callId>): <error>`.

`packages/workflow/workflow-ptc/src/index.ts:Config.maxDurationMs`: overall elapsed deadline for one workflow run, in milliseconds (finding 282). Default 3,600,000 (one hour); `0` disables it and the maximum is 2,147,483,647 (the `setTimeout` limit). It applies to every run the engine starts, including a Ralph loop, which runs all its rounds as one workflow run. A deployment that runs longer jobs raises the value or sets `0`.

`packages/workflow/workflow-ptc/src/host.ts:PtcWorkflowRun`: the deadline is a host-side timer started when the run is constructed and cleared when `drive` settles. It is not passed to PTC as `timeoutMs`, because the Node PTC runtime clamps and rejects `timeoutMs` above its own `maxTimeoutMs` and a workflow routinely outlives that. The timer is host-side so that it still fires when the guest is stuck in a synchronous loop after its first `await` (the VM `syncTimeoutMs` only covers the first slice). On expiry the run aborts through the same path as `PtcWorkflowRun.cancel`, which stops the PTC process and disposes pending and published children, but `PtcWorkflowRun.cancelled` reports it as `stopReason: 'error'` with `errorCode: 'RUN_FAILED'` and an `error` naming the deadline. A cancelled run would reach the background job as `killed` with no detail, so the deadline is reported as a failure the owner can read.

`packages/subagent/subagent/src/index.ts:SubagentRuntime.start`: the one-shot slot exists only while an `agents` service is injected. Continuable children the parent already holds share the same pool, so the effective fan-out can be lower than the sampled cap.

`packages/boot/plugin-manager/src/index.ts:PluginManager.installBundle` and `PluginManager.waitForInstall`: the trailing `signal` parameter is the typert cancellation marker (the analyzer requires the name `signal` and the global `AbortSignal` type), so the Client gives these calls no unary deadline. The Host never cancels an installation on that signal; an installation ends only through its own result or `cancelInstall`. Before this, the 30 s gateway deadline folded a slow install into `gateway/internal`, and the store's `reconcileInstall` was cut at 30 s too.

`packages/api/gateway/src/client/index.ts:ClientRemoteService.invoke`: the unary deadline applies only to descriptors without `cancellation`. A call that outlives it still runs on the Host, so the Client cannot know its outcome; the deadline result says so only through the message.

`packages/client/hmr/tests/transport.client.spec.ts:provideEntries`: the helper keeps the cast's token shape identical to the recorded unknown-cast baseline entry. Rewriting the cast with different tokens would count as a new assertion to `unknown`.

## API-credits billing choice

`packages/client/ui-settings-models/src/client/ProviderEditor.tsx:ProviderEditor`: a pi-ai route bills to API credits exactly when its profile names an `apiKeyEnv` reference, because llm-pi-ai resolves a named reference as the explicit key and pi-ai's override wins over any stored sign-in. The subscription choice therefore drops `apiKeyEnv` and leaves the stored OAuth grant to pi-ai. The choice appears only when the route's sign-in flow offers both `oauth` and `api-key` methods, and it locks when a composition layer pins `apiKeyEnv`. Apply names the reference only when a key is stored or typed, so an unrelated save never names a reference the card cannot resolve.

`packages/client/ui-settings-models/src/client/ProviderEditor.tsx:ProviderEditor`: the active note reports the saved state, not the pending pick. A stored `api-key` record counts as API credits, because pi-ai resolves that record as the request key. The sign-in card starts only the flow's first method (`SignInCard.tsx:SignInCard`), so this state is reached only by a flow whose api-key method is started elsewhere, not from the card. While that record is in place the Subscription option is disabled, with a hint: the record is the only credential at the route's slot, and Subscription would leave requests on it. Signing in with the subscription replaces the record, which is the way to switch.

`packages/api/settings-controller/src/authorization.ts:AuthorizationController.list` and `packages/api/settings-controller/src/types.ts:AuthorizationEntryView`: each entry carries the stored record's `kind` (`grant` for a sign-in, `api-key` for a pasted key) read from `credentials.describeRecord`, so the page can tell the two apart without reading a secret. Both kinds share one record slot per provider, so signing in replaces the other.

`packages/client/ui-settings-models/src/client/BillingChoice.tsx:BillingChoice`: presentational only. The editor owns the draft, and the two options are `aria-pressed` toggles in a labelled group.

`packages/subagent/subagent-claude-code/src/api-credits.ts:withApiCreditsKey`: the Claude CLI reads the same signal from the `anthropic` route's profile, found through `llm.listConfigurableProviders`. When that profile names a reference, the stored credential is passed as `ANTHROPIC_API_KEY`. When it names none, the `llm-pi-ai/anthropic` record is read instead, and only an `api-key` record with a key is passed; a subscription grant record is never sent as a key, which is the same record pi-ai reads for requests. An explicit `ANTHROPIC_API_KEY` in the subagent config wins. A named reference that resolves to nothing fails the start, and the message names the reference, never its value. `packages/subagent/subagent-claude-code/src/index.ts:start` calls it once per run, so the stored key is read at each run start. The CLI's precedence of `ANTHROPIC_API_KEY` over its `/login` sign-in comes from the Agent SDK's `apiKeySource` contract and is unverified by a live run.

`packages/subagent/subagent-claude-code/src/api-credits.ts:withApiCreditsKey`: the key is withheld when `ANTHROPIC_BASE_URL` is in the child environment (the scrubbed parent environment plus explicit config), since that would send an Anthropic key to whatever endpoint the variable names. The run continues without it and logs a warning.

`packages/subagent/subagent-claude-code/src/index.ts:ClaudeCodeProvider.start`: the child environment is resolved per run, so a key stored or removed between runs applies from the next run on.

`packages/client/ui-settings-models/tests/billing-choice.client.spec.tsx:billing choice on a route with a sign-in and an API key`: pins each saved state the note reports and exactly what Apply writes for each pick, including that an unrelated save never names a missing reference. `packages/subagent/subagent-claude-code/tests/api-credits.spec.ts:the Anthropic route key in a Claude Code run`: pins the environment the SDK receives for each of those states, using a fake key built at runtime, including a sign-in api-key record with no reference and a subscription grant record that must not be sent. `packages/client/ui-settings-models/tests/billing-choice.client.spec.tsx:billing choice on a route with a sign-in and an API key` also pins that Subscription is disabled while the sign-in stores an API key.

## OpenCode model catalog corrections

`packages/llm/llm-pi-ai/src/catalog-corrections.ts:CORRECTIONS` fixes installed pi-ai 1.2.0 entries that the docs contradict: Zen `gpt-5.6-terra` takes the docs' prices (2 / 12 / 0.2 / 2.5) and its tier above 272,000 input tokens (4 / 18 / 0.4 / 5); Zen `deepseek-v4-pro` output is 3.48; Zen `kimi-k2.5` cache read is 0.1; the `openai` route's `gpt-6.1-sol` context is 1,050,000, as models.dev lists it for `openai` and `opencode`. Corrections that 1.2.0 already matches were removed (Go `qwen3.7-plus`, `qwen3.8-max` and `glm-5.3-flash`; Zen `gpt-5.6-sol`; the `minimax-m2.7` cache write). pi-ai 1.3.0 dropped Go `minimax-m2.7`, so its `api` correction was deleted. `catalog-corrections.ts:Correction` no longer carries `api` or `baseUrl`, and `catalog-corrections.ts:correctCatalogModel` keeps the installed `compat` for every correction, since no entry repoints `api` now.

`packages/llm/llm-pi-ai/src/catalog-corrections.ts:correctCatalogModel` moves every OpenCode base from `https://opencode.ai/zen` to `https://opencode.ai/inference` once, for installed and supplemented entries alike, and then applies the route's correction. Each SDK appends its own path to that base: pi-ai hands `model.baseUrl` to the Anthropic client (which appends `/v1/messages`), to the OpenAI client (`/chat/completions`, `/responses`), and to `@google/genai` with `apiVersion` cleared (`models/<id>` after the base, pi-ai's `google-generative-ai` `createClient`). So an Anthropic base has no `/v1`, which is why the `minimax-m2.7` correction carried its base until 1.3.0 dropped that entry. The resulting URLs match the docs' endpoint tables. Zen: `anthropic` `https://opencode.ai/inference/v1/messages`; `openai-completions` and `openai-responses` `https://opencode.ai/inference/v1/chat/completions` and `https://opencode.ai/inference/v1/responses`; Gemini `https://opencode.ai/inference/v1/models/<id>`. Go: `anthropic` `https://opencode.ai/inference/go/v1/messages`; `openai-completions` and `openai-responses` `https://opencode.ai/inference/go/v1/chat/completions` and `.../go/v1/responses`; Gemini `https://opencode.ai/inference/go/v1/models/<id>`. `adapter.ts:isOpencodeRoute` is unchanged, because it matches the provider names `opencode` and `opencode-go` and the hostname `opencode.ai`, which the new base keeps.

`packages/llm/llm-pi-ai/src/catalog-corrections.ts:RETIRED` hides installed ids that the docs and `/models` no longer carry: Zen `claude-sonnet-4` and `deepseek-v4-flash-vision-exp`. pi-ai 1.3.0 itself dropped Go `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` and Zen `ling-3.0-flash-fin-free`, so those entries left the list. Zen `deepseek-v4-flash` and `nemotron-3-ultra-free` are served by 1.2.0 and stay. `catalog.ts:catalogModels` applies the hiding after the supplement merge.

Where sources disagree the code follows the docs for endpoints and prices. Zen and Go list different windows for `qwen3.8-max` (models.dev: 262,144 and 1,000,000), and the installed values stand on both routes. The Codex route's 272,000 windows are as pi-ai ships them; models.dev has no `openai-codex` row to check them against.

## pi-ai 1.3.0 upgrade

`packages/llm/llm-pi-ai/package.json` pins `@earendil-works/pi-ai` at `^1.3.0`; `pnpm-workspace.yaml:minimumReleaseAgeExclude` and `patchedDependencies` name `pi-ai@1.3.0` and `pi-telemetry@1.3.0` (pi-ai pins telemetry to the same version). `patches/@earendil-works__pi-ai@1.3.0.patch` is the 1.2.0 patch carried over: 1.3.0 still calls `parseStreamingJson` on every tool-call delta in the same six modules, and the hunks apply with shifted offsets only.

`packages/llm/llm-pi-ai/src/catalog-supplement.ts:SUPPLEMENT` lost the four entries 1.3.0 ships. `packages/llm/llm-pi-ai/src/catalog-corrections.ts:CORRECTIONS` and `RETIRED` lost the entries for ids 1.3.0 removed (Go `minimax-m2.7`, Go `deepseek-v4-flash`, Go `deepseek-v4-flash-vision-exp`, Zen `ling-3.0-flash-fin-free`). The Zen `deepseek-v4-pro` output (3.48), `gpt-5.6-terra`, `kimi-k2.5` and `openai` `gpt-6.1-sol` corrections still differ from 1.3.0 and stay. 1.3.0 moves every OpenCode base URL to `/inference` itself; `correctCatalogModel` still rewrites the remaining Zen supplement (`gpt-5.3-codex-spark`).

`pi-ai/dist/api/transform-messages.js:transformMessages` in 1.3.0 drops thinking from another model instead of replaying it as plain text, so `packages/llm/llm-pi-ai/tests/convert.spec.ts` expects `content: []` for a cross-model Anthropic replay. `openai-codex` `gpt-6.1-sol` context is now 500,000 in the installed catalog.

## pi-ai 1.2.0 upgrade and xAI sign-in

`packages/llm/llm-pi-ai/package.json` pins `@earendil-works/pi-ai` at `^1.2.0`. `pnpm-workspace.yaml:minimumReleaseAgeExclude` exempts `@earendil-works/pi-ai@1.2.0` and `pi-telemetry@1.2.0` from the release-age window, because a fresh catalog release is the point of the bump. The 0.85.1 patch no longer applied (its `pi-messages.js` hunk context moved, so `pnpm install` failed with ERR_PNPM_PATCH_FAILED). `patches/@earendil-works__pi-ai@1.2.0.patch` was regenerated with `pnpm patch` and `pnpm patch-commit`; it removes the same six per-delta `parseStreamingJson` calls, in the anthropic-messages, bedrock-converse-stream, mistral-conversations, openai-completions, openai-responses-shared and pi-messages modules. `pnpm-workspace.yaml:patchedDependencies` names it, and `packages/llm/llm-pi-ai/README.md` cites it.

The compat gates in `catalog.ts:COMPLETIONS_COMPAT_GATE`, `catalog.ts:RESPONSES_COMPAT_GATE` and `catalog.ts:ANTHROPIC_COMPAT_GATE` name every key pi-ai 1.2.0 declares (`satisfies Record<keyof XCompat, CompatDisposition>`). Keys pi-ai dropped (`deferredToolsMode`, `supportsToolReferences`) left the gates. New mid-conversation keys are `'withhold'`, so the harness does not offer them as profile fields until it can express them. `catalog.ts:MISTRAL_COMPAT_GATE` is the gate for the `mistral-conversations` protocol, registered in `COMPAT_GATES`. `replay.ts:parseArguments` returns `JsonObject` because pi-ai 1.2.0 types `ToolCall.arguments` that way; the parse itself is unchanged.

`login.ts:loginMethods` offers every OAuth method pi-ai ships, xAI included, alongside each API-key login. The vendor-owned OAuth clients are not all the vendors' own apps: `xai.js` presents the Grok CLI's public client (id prefix `b1a00492…`) with the `grok-cli:access api:access` scope, and four others present another product's client (below). Those sign-ins are not hidden, because hiding them would hide the only sign-in some providers offer; instead the Models card labels them and asks for confirmation before they start. The change alters nothing stored: a credential already in the store keeps resolving.

`login.ts:registerPiAiFlows` offers every catalog provider with a pi-ai OAuth flow. Audit of `dist/auth/oauth/*` in pi-ai 1.2.0, with the client identity the module states; the product named for a client is an inference from the id unless the module names it:
- Anthropic (`anthropic.js`, "Anthropic (Claude Pro/Max)", provider `anthropic`): public client id prefix `9d1c25…`, believed to be Claude Code's client (unverified). Borrowed login.
- GitHub Copilot (`github-copilot.js`, provider `github-copilot`): client id `Iv1.b507…` and `User-Agent: GitHubCopilotChat/0.35.0`, impersonating Copilot Chat. Borrowed login.
- Kimi Code (`kimi-coding.js`, "Sign in with Kimi Code", provider `kimi-coding`): client id prefix `17e5f671…`, believed to be the Kimi Code client (unverified). Borrowed login.
- OpenAI ChatGPT (`openai-chatgpt.js`, "Sign in with ChatGPT", provider `openai`): a dynamic client id taken from the authorization request, with the `chatgpt.tokens.use.direct` scope. Offered.
- OpenAI Codex (`openai-codex.js`, "OpenAI (ChatGPT Plus/Pro)", provider `openai-codex`): client id prefix `app_EMoa…`, believed to be the Codex CLI client (unverified); `originator` defaults to `pi`. Borrowed login, with no API-key method.
- OpenRouter (`openrouter.js`, "Sign in with OpenRouter", provider `openrouter`): its own sign-in flow, with no third-party client id. Offered.
- Radius (`radius.js`, provider `radius`): pi's own `pi-gateway` client with the `gateway offline_access` scope. Offered.
- Meta (`meta.js`, "Sign in with Meta", provider `meta`): numeric client id prefix `1031…`; the module does not name a product. Offered.
- xAI (`xai.js`, provider `xai`): the Grok CLI client and scope above. Borrowed login.

`login.ts:BORROWED_APP_LOGINS` is the one table of providers whose OAuth login borrows another product's identity (anthropic, openai-codex, github-copilot, kimi-coding, xai), keyed by provider id and naming the app the confirmation shows. The client-id attributions are inferred from id prefixes and module labels and are not verified against the vendors. The risk is that a vendor may restrict or suspend accounts that sign in through another app's login, so the policy is to label and confirm rather than to hide.

The Models card enforces the confirmation. `ui-settings-models/src/client/SignInCard.tsx:SignInCard` shows a "Borrowed login" label beside the sign-in button when the flow carries `borrowedFrom`, which `authorization/src/index.ts:AuthorizationService.list` passes through and `settings-controller/src/authorization.ts` carries to the view. The button opens a plain-language confirmation; only its "Sign in anyway" action calls `begin`. Its "Use an API key instead" action focuses the API-key field through `ProviderEditor.tsx:ProviderEditor`, and its cancel action leaves the flow unstarted. When a stored `grant` record belongs to a borrowed flow, the card shows the same warning and actions. The official-CLI action is not offered: the Claude Code delegation page (`subagent-claude-code`) exists, but the Models card has no navigation seam to it, and no Codex delegation page exists.

The stored credential is never touched: `llm-pi-ai/src/auth.ts:credentialStoreFrom` reads records without consulting the flows.

pi-ai 1.2.0 ships no Gemini CLI or Antigravity OAuth module.

`adapter.ts:withOpencodeSession` leaves a configured `X-OpenCode-Session` in place and adds nothing. The name reaches the wire lowercase because the SDK and fetch layer normalise header names, so `tests/adapter.spec.ts` asserts one copy rather than the spelling; HTTP header names are case-insensitive.

## Mid-turn steering and long waits

`packages/core/agent-loop/src/agent.ts:ReactLoopAgent` (`followup`, `steer`): a follow-up queues in `next-turn` and a steer goes to `next-step`. `packages/core/agent-loop/src/agent.ts:ReactLoopAgent` (`turn`) claims `next-turn` only on a turn's first step, so a queued follow-up waits until the current turn stops calling tools. A steer is claimed at the next step boundary, which falls after every tool call of the step, so a tool that blocks holds the steer until it returns.

`packages/jobs/tool-jobs/src/index.ts:apply`: a user steer that reaches an owner's `next-step` inbox (`agent/inbox/inserted`) releases that owner's blocking `job_output` waits. In the desktop session behind the report, `job_output` with `wait: true` asked for 300 s, 400 s, 450 s and 420 s (steps 46, 47, 67 and 72); steps 46 and 67 ran to their full timeout, while 47 and 72 returned after 76 s and 31 s. The steer queued during step 67 waited about three minutes for its step-68 boundary. `packages/jobs/tool-jobs/src/index.ts:awaitJob` returns the job's current state (`[status: running]`) plus a note that a user message arrived when a steer releases the wait; only the wait ends, so the job is never cancelled and its output stays readable, and skips the wait when a steer is already pending. A job that settles after a released wait notifies its owner as an unawaited completion, as for any wait the caller leaves.

`packages/api/session-controller/src/commands.ts:SessionCommandController.updateQueue`: the queue `steer` action removes a queued follow-up from `next-turn` (outcome `canceled`) and steers it into `next-step`. `packages/client/ui-conversation/src/client/input/hub.ts:steerQueue` sends that action for every queued item (the steer chord); `packages/client/ui-conversation/src/client/queue/QueueDock.tsx` sends it for one row.

`packages/goal/goal-round-driver/src/index.ts:apply`: Goal rounds never hold a turn open. A round is queued with `followup` only while the agent is idle, and a user item entering `next-turn` marks a pending round stale, so a Goal does not starve queued human input. Steers reach the model at step boundaries whether or not a Goal is active.

`packages/client/ui-chat/src/client/presentation-policy.ts:POLICIES`: under `standard`, `stepGrouping: 'collapsed'` folds the open Turn's steps behind one live header (`packages/client/ui-chat/src/client/chat/ChatGroupSeat.tsx:ChatGroupSeat`), whose title shows only the current activity and tool name. The running line added no step progress, so a long wait looked frozen.

`packages/client/ui-chat/src/client/chat/RunningStatus.tsx:RunningStatus`: the running line also names the open step. `packages/client/ui-chat/src/client/chat/ChatView.tsx:ChatView` passes `openStep`, which is `sessionStats.steps + 1`. `steps` counts closed steps for the whole session, the same figure as the footer's "N steps".

## CLI terminal Sessions

`packages/api/terminal-controller/src/cli-profiles.ts:CLI_TERMINAL_PROFILES`: the table of user-run agent CLIs (Gemini CLI, Grok CLI, Cursor CLI). Each row names the command, the vendor install page, and the picker copy keys in `ui-model-selection` and `ui-sidebar-terminal` locales. Nothing else knows the commands, so a new CLI is one row plus its copy keys.

`packages/api/terminal-controller/src/cli-profiles.ts:cliStartupArgv`: the startup argv per shell family. PowerShell runs `-NoLogo -NoExit -Command <command>`, cmd runs `/k <command>`, POSIX shells run `-i -c '<command>; exec "$0" -i'` so the shell stays open after the CLI exits, and other shells run `-i -c <command>`. No profile flags are added; the user's own CLI and its login run unchanged.

`packages/api/terminal-controller/src/index.ts:TerminalController.spawn`: the CLI branch starts the argv in the Session's cwd with `inheritEnvironment: true` and no environment overlay, so the CLI sees the user's environment unscrubbed, and `shellActivity: false`, so DSH does not inspect the shell. The install probe is `executableInstalled`, which resolves the command on the execution environment's PATH; an absent command still opens the shell and reports `cli.installed: false`.

`packages/subprocess/subprocess/src/index.ts:userParentEnv`: the environment a CLI terminal inherits. It is the Host process environment minus DSH-internal variables, with the proxy names restored to the values the user exported, and it is not credential-scrubbed. `packages/subprocess/subprocess/src/types.ts:SubprocessTerminalSpawnSpec` declares `inheritEnvironment`, and `packages/ssh/subprocess-ssh/src/index.ts:SshSubprocessRuntime.spawnTerminal` rejects it, because a remote host has no local user environment to inherit. `packages/subprocess/subprocess/src/index.ts:SubprocessRuntime.inheritsUserEnvironment` is the matching capability flag (false by default, true only on `LocalSubprocessRuntime`); `TerminalController.cliProfiles` returns no profiles and `TerminalController.spawn` refuses a CLI terminal when it is false, so a Session on an SSH execution never offers an entry it could not launch.

`packages/api/terminal-controller/src/index.ts:TerminalController.cliLaunch`: a CLI terminal opens only on the Session created for that profile. The profile is persisted as the `session/cli-terminal` event and read through the `cliTerminal` Session projection (`packages/core/agent-loop/src/projections.ts:cliTerminalProjectionDefinition`), never by scanning the event log, which `.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md` prohibits for new code. A reattached or forged profile is rejected with `terminal/cli-session-mismatch`. The controller reads the projection with `ctx.get('sessionProjections')` because its `inject` list does not name the service; an absent service reads as an ordinary Session.

`packages/api/terminal-controller/src/index.ts:TerminalController.cliProfiles`: reports the installed state and install URL of every profile for the picker, probed in the Session's execution environment and never in the Host's own process environment.

`packages/api/session-controller/src/agent.ts:withCliMarker`: the marker event lands before `agent/created`, inside the agent setup transaction, so every listener that reacts to a new Agent already sees the CLI identity. `ApiSessionAgentController.refuseCliSession` rejects `session/prompt` for a CLI Session with `session/cli-terminal`, so no user message is recorded and no turn starts. `packages/core/agent-loop/src/agent.ts:ReactLoopAgent.send` is the single funnel under every `followup` and `steer`, and it throws for a CLI Session whenever the input would wake a turn. That covers every other submitter (schedule, goal driver and command, agent-team mailbox, ACP, job notices, subagent inbox, webhook, SDK server) without touching each one; input that only injects (`wakeup: false`) still queues.

`packages/client/ui-memory-workspace/src/automation.ts:MemoryAutomation`: CLI Sessions stay out of automatic chat memory, both saves and recall. They are registered for the `this.cli` set on `agent/created` (read through `packages/core/agent/src/cli-terminal.ts:cliTerminalProfileOf`), skipped on `session/event`, and forgotten on `session/disposed`.

`packages/experimental/hooks-claude-code/src/index.ts` and `packages/experimental/hooks-codex/src/index.ts` (`agent/created` handler): SessionStart hooks do not run for a CLI Session. Turn hooks (`agent/pre-step`, `agent/turn-stopping`) never fire because no turn starts, which `ReactLoopAgent.send` enforces for every submitter.

`packages/client/ui-sidebar-terminal/src/client/CliTerminalPane.tsx:CliTerminalPane`: the full-page pane replaces the conversation for a CLI Session. The install hint, the vendor link and the exit status sit outside the terminal screen. `packages/client/ui-sidebar-terminal/src/client/terminal.tsx:TerminalScreen` is the only place that writes to the PTY, and only from xterm's `onData`, paste and resize.

`packages/client/ui-model-selection/src/client/CliTerminalEntries.tsx:CliTerminalEntries`: the picker group shows installed profiles as menu items that open a terminal Session, and absent ones as a muted link to the install page. It renders nothing until the probe answers, and nothing when the probe fails.

`packages/api/session-controller/src/list-metadata.ts:SessionListMetadata`: declared in its own client-visible file and re-exported from `types.ts`, not in `list.ts`. `list.ts` is Host-only and imports the `@deepseek-ai/dsh-session` root, whose `Context.sessions: SessionStore` augmentation conflicts with the Client's `ISessions` declaration in any client project that includes it, which produced 134 type errors across the client program. Keep `src/list.ts` out of `tsconfig.client.json`.

Guarantees, applied the same to every profile: DSH writes to the PTY only from the user's keystrokes, paste and resize. Terminal output is not captured, stored, sent to telemetry, or summarized; it lives only in the xterm scrollback in the browser and in the Host's in-memory headless screen that serves reattachment (`packages/api/terminal-controller/src/terminal.ts`), which is never written to disk. DSH never reads the CLIs' configuration or credential folders (`cli-profiles.ts` names none, and the source scan in `packages/api/terminal-controller/tests/cli-terminal.spec.ts` fails on any reference). Agent-accessible terminal tools (`packages/terminal/terminal-bash`, `packages/experimental/tool-terminal`) do not reach the web-terminal controller, and a source scan pins that.

Why: the user runs the vendor's own CLI in a plain terminal, which is ordinary CLI use under each vendor's terms. DSH only starts it and forwards the user's input, so there is no transcript, no model call over the session, and no memory or hook data derived from it.

`packages/client/ui-sidebar-terminal/src/client/LazyCliTerminalPane.tsx:LazyCliTerminalPane` loads `CliTerminalPane` through `terminal.tsx` (which re-exports it) so the pane ships inside the existing `client.terminal.js` chunk. A separate `client.CliTerminalPane.js` chunk would `require("./client.terminal.js")` at load, and the client module loader only materializes chunks reached by `require.async` from the entry, so the CLI page rendered blank with "missed the module table". `tests/bundle-split.client.spec.ts` pins one async chunk and no chunk-to-chunk requires.

`packages/api/session-controller/src/list.ts:ApiSessionList.summaryFor`: a cached `sessionListMetadata` that says blank is confirmed with `stateOf`, the folded state. The `session/cli-terminal` marker is appended inside agent setup, after the cached cell was last materialized, so the cache still reported a blank Session with no profile. The `api-session/added` announcement carried that stale row, the client kept it blank, and the sidebar hid blank rows that are not current. Only a blank can hide a Session, so only that case folds, and an ordinary listing still reads the cache and never folds history (`packages/api/session-controller/tests/session-projections.host.spec.ts`). `packages/api/session-controller/tests/cli-session.host.spec.ts` pins the announced summary.

`packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx:ConversationContent`: the body of a CLI Session is the `conversation.cli` slot alone, so the composer and the Chat, Trajectory and Subagent Setup views are not rendered. `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx:ConversationSessionHeader` hides its tab strip for such a Session, because a tab could not change what is shown. The CLI pane's own header is therefore the only way out of the CLI.

`packages/client/ui-sidebar-terminal/src/client/CliTerminalPane.tsx:CliTerminalPane`: the header names the profile and holds the Close button. `packages/client/ui-sidebar-terminal/src/client/index.ts:apply` (the `conversation.cli` inject, `close`) closes the terminal, archives the Session with `stopActivity`, then calls `uiWorkspace.startSession()`, which opens a New Session. Close has no confirmation, because a CLI Session has no turns; the sidebar archive dialog only appears for running activity.

`packages/api/terminal-controller/src/client/index.ts:ClientTerminals.closeCli`: closes through the same owner cleanup as a closed tab but keeps the view registered. Removing it would let the pane's next render run `cliView` again and start the command a second time. `packages/api/terminal-controller/src/client/model.ts:TerminalView.close` leaves `closing` set, and both `refresh` and `connect` return early once it is set, so a re-render after Close cannot respawn the process.

`packages/client/shortcuts/src/client/registry.ts:ShortcutRegistry.dispatch`: inside xterm (region `terminal`) only commands whose `regions` include `terminal` run, such as `terminal.new` in `packages/client/ui-sidebar-terminal/src/client/index.ts:apply`. Global commands such as `session.new` (`packages/client/ui-workspace/src/client/shortcuts.ts`) are `page` and `editable` only, so they pass through to the CLI exactly as they do in the sidebar terminal. Typing in the CLI is never intercepted, and the Close button is the exit.

`packages/client/ui-workspace/src/client/navigation.ts:reuseOrCreateBlank`: New Session reuses only a blank Session in the Workspace. `packages/api/session-controller/src/list.ts:applySessionListMetadata` clears `blank` on `session/cli-terminal`, so a CLI Session is never reused, and `openCliTerminal` in `packages/client/ui-model-selection/src/client/index.ts` creates the CLI Session without a `workspaceId`, so it lands in Ungrouped.

## Watch tool and goal waits

`packages/jobs/tool-watch/src/index.ts:apply`: a watch is a job of kind `watch`, not a new service or delivery path. Starting it through `ctx.jobs` reuses cancellation, the per-owner job limit, the job list, the client roster (kind, label, progress, kill), and the completion notice from `@deepseek-ai/dsh-tool-jobs`, so neither the client nor tool-jobs changed.

`packages/jobs/tool-watch/src/index.ts:apply`: loading refuses a shell whose `sandboxMode` is set when no `sandboxPolicy` service is mounted, the same rule the bash tool applies. Checks never widen the policy: `runCheck` passes the session's resolved policy and never requests approval, so a watch cannot run with more access than the shell it shares.

`packages/jobs/tool-watch/src/index.ts:parseUntil`: exactly one of `exit_code`, `regex`, or `changed` is accepted, and `changed` must be `true`. A regex compiles once at call time with the multiline flag, so an invalid pattern is a rejected call rather than a check that fails forever. `apply` also rejects an `interval_s` longer than the call's timeout, and the config schema caps both timeout settings at 35791 minutes: a timer delay above 2^31-1 ms fires after 1 ms in Node, which would have turned a huge interval into a tight polling loop.

`packages/jobs/tool-watch/src/poll.ts:startWatch`: the deadline aborts the check loop's controller with a private symbol as the reason, and cancellation aborts without one. `watchUntilSettled` reads `signal.reason`, so a timeout settles `completed` with a timed-out detail (the condition was checked and did not hold) and a kill settles `killed` with the reason the registry records. `done` never rejects.

`packages/jobs/tool-watch/src/poll.ts:runCheck`: each check re-resolves the session's sandbox policy and hands it to `ctx.shell.resolve`, so a mode change applies from the next check. A timed-out check, a sandbox runner failure, or a thrown error counts as a failed check. `runCheck` never rejects, so the failure count is the only failure path.

`packages/jobs/tool-watch/src/poll.ts:watchUntilSettled`: `maxConsecutiveErrors` consecutive failed checks end the watch as `failed`, and one completed check resets the count. The first completed check sets the `changed` baseline, so `changed` cannot fire on its own first output. The result keeps the last 4000 characters of output, because `job_output` returns it once after settlement.

`packages/jobs/tool-watch/src/poll.ts:meets`: `exit-code` and `regex` test the current check; `changed` compares it with the baseline set by the first completed check.

`packages/jobs/tool-watch/src/poll.ts:matches`: the model supplies the regex, so the test runs through `vm.runInNewContext` with a 250 ms timeout, which interrupts catastrophic backtracking where a plain `RegExp.test` would block the host's event loop. A timeout throws, `watchUntilSettled` turns it into a failed check, and the existing consecutive-failure limit ends the watch with the regex named in the detail. The output the pattern sees is already bounded by the shell executor's stdout cap.

`packages/goal/goal-round-driver/src/index.ts:awaitingWatch`: a goal waits while its owner has a `running` watch. `stopping` is deliberately not counted. A model-initiated `job_kill` moves the job to `stopping` synchronously and produces no notice, so counting `stopping` would leave the goal waiting for a settlement that never wakes it.

`packages/goal/goal-round-driver/src/index.ts:drive`: the watch gate runs after the active and armed checks and before the round budget, so pause, resume, and completion keep their own handling while a goal waits.

`packages/goal/goal-round-driver/src/index.ts:awaitingWatch`: the first time the gate holds a goal, it subscribes once to job events (`jobs` is read lazily with `ctx.get`, so the driver still mounts without it) and re-requests a drive when a watch settles for a live owner, one microtask later so the tool-jobs notice listener has already woken or injected into the owner. Without it, a settlement whose notice is only injected into an idle owner (`completionDelivery: quiet`, or a spent `maxConsecutiveWakes` budget) re-runs nothing, and the goal would wait for the next user message.

`scripts/tool-catalog-manifest.ts:TOOL_PACKAGES`: the boot manifest moved out of `scripts/gen-tool-catalog.ts` so that file stays under the 750-line limit; the generator imports the manifest and re-exports `ToolPackage`. The two `as unknown` entries in the baseline moved with their lines, and their fingerprints are token-based, so they match unchanged.

`scripts/tool-catalog-manifest.ts:registerCatalogSubagentProvider`: the provider declares `prepareContinuable` so consumers configured for continuable background mode mount.

`scripts/tool-catalog-manifest.ts:TOOL_PACKAGES`: the `mount` of each entry mounts only what its tool injects, because schema harvest never runs a tool. `plugin-manager` never executes a management method or opens a profile. `tools` is the registry's own `run_code` tool, which exists only under a non-native mode: the registry registers it in its constructor and reads the PTC runtime at assembly or execution time, so harvest mounts none. `tool-bash` and `tool-pwsh` compose the job registry because the shipped profiles do and the background surface follows it; `tool-pwsh` also mounts the pwsh-local executor so its `shell` inject resolves, and registration never spawns a process. `tool-fs` needs only the bare `fs` provider because policy changes behavior, not schema shape, and the catalog seam marker opts into the attachments-conditional image schema without attachment I/O. `tool-fs-search` mounts the real local `subprocess` service because search spawns the packaged ripgrep through that seam and registration never spawns; `ctx.spillStore` is optional and does not affect the schemas, so no spill backend is mounted. `tool-lsp` registers from the seam alone. `tool-workspace-dependencies` never prepares a payload, so its directory need not exist. `tool-web` mounts search and fetch providers so both tools register; their schemas do not depend on provider identity or availability.

## Usage warnings and Claude subscription windows

`packages/client/ui-provider-quota/src/client/usage-prompt.ts:usagePrompt`: one composer prompt at a time. A provider status other than `ok` is a hard limit at any percentage and outranks every near-limit window. A near-limit window is one at or above the threshold the dock passes in (`NEAR_LIMIT_PERCENT`, 90, when none is passed). Near-limit windows rank by length across all providers (`WINDOW_HOURS`: five hours 5, weekly 168, monthly 720, credits 0), so a monthly window outranks a five-hour window from another provider. The overage window's length of 720 is an assumption: Claude reports no length for it, so it ranks as monthly.

`packages/client/ui-provider-quota/src/client/usage-prompt.ts:withDismissed`: a dismissal key ends in its window's reset time and lapses when that time passes, so a dismissed prompt stays quiet until its window resets and a later window at the threshold prompts again. A window that reports no reset time has a key ending `|open`; its dismissal is stored as the key plus an expiry `OPEN_WINDOW_HOLD_MS` (24 hours) after the click, and `isDismissed` honors it only until then, so the prompt returns after a day. Keys with any other non-numeric tail are kept until the stored list is cleared, and bare `|open` entries from earlier builds are dropped on the next dismissal.

`packages/client/ui-provider-quota/src/client/usage-limit-card-controller.ts:UsageLimitCardController`: the threshold is a user setting in the Host's `quota-controller` namespace. Staged text is saved against the namespace revision it started from, and an empty field unsets the key so the default applies again. The dock reads the Host-accepted value through `nearLimit`, which stays at `NEAR_LIMIT_PERCENT` until the Host serves the namespace, so a deployment without the setting keeps the default.

`packages/api/quota-controller/src/index.ts:QuotaController`: `static Config` declares `nearLimitPercent` as a whole percent from 50 to 100, default 90, volatile so the settings page can change it while the Host runs. The config catalog takes the constructor's second parameter as the config type, which is why the same field is declared on `QuotaControllerInternals`. The controller does not read the value.

`packages/client/ui-provider-quota/src/client/UsageSwitchPrompt.tsx:UsageSwitchPrompt`: quota refreshes once when a running turn ends, not on each model step. A per-step refresh would call the provider usage reads, including the OpenAI Codex network read, on every model step.

`packages/client/ui-provider-quota/src/client/index.ts:apply`: the Plugins page entry `provider-quota` mounts only while the Host serves `quota-controller`, so a deployment without the namespace shows no trace of the setting.

`packages/client/ui-provider-quota/src/client/controller.ts:ProviderQuotaController.switchBilling`: writes the route's billing choice, its `apiKeyEnv` under `providers.<route>`, through `remote.settings.mutate` in the namespace the quota result names, the same path the Models billing choice uses. A subscription switch unsets the key. The last switch to API credits remembers the reset time of the window it answered, so the switch back is offered once that window resets. `UsageSwitchPrompt` passes a day after the click (`OPEN_WINDOW_HOLD_MS`) when that window reports no reset, so the switch back is still offered; a switch from the popover button remembers nothing. `ProviderQuotaController.dismiss` on a `back|` key forgets the switch instead of storing a key, because the key's reset time is already past and would be pruned, bringing the offer back after the next unrelated dismissal.

`packages/llm/llm-pi-ai/src/claude-quota.ts:claudeObservationsFromHeaders`: reads the `anthropic-ratelimit-unified-5h-*` and `anthropic-ratelimit-unified-7d-*` headers of each Anthropic response. Utilization is read as a 0 to 1 fraction, and `createClaudeUsage` reads a value above 1 as whole percent (a header or SDK event that sends percent would otherwise clamp to 100). A reset below 1e9 is seconds from the response, below 1e12 is epoch seconds, a larger number is epoch milliseconds, and an RFC 3339 string is parsed. These units follow from the header names and are not checked against a captured live response.

`packages/llm/llm-pi-ai/src/claude-quota.ts:createClaudeQuotaSource`: subscription usage is read, not waited for. For a stored OAuth sign-in, `fetch` resolves the sign-in token through pi-ai (`builtinModels(auth).getAuth`, which refreshes it the way a request would) and reads `GET https://api.anthropic.com/api/oauth/usage` with the `anthropic-beta: oauth-2025-04-20` header. The sign-in scopes include `user:profile`, which that endpoint needs. Its `five_hour`, `seven_day`, `seven_day_opus` and `seven_day_sonnet` members map to the 5h, weekly, weekly Opus and weekly Sonnet windows, and `extra_usage` (when enabled) to the overage window. Utilization there is whole percent, so it is not run through the 0-to-1 reader that response headers use. The endpoint, its field names and its percent units come from how Claude Code reads it and are not checked against a live reply here. A reply is reused for `USAGE_TTL_MS` (60 s) because each turn end refreshes quota. When the read fails (HTTP error, unparseable body, sign-in failure) the windows observed on responses stay, with their `asOf` time, and the failure text goes to `QuotaResult.subscriptionError`; `awaitingUsage` is set only when nothing failed and nothing was observed. An API-key record or an environment key makes no usage request. Response-header and Claude Code run observations still feed the same windows, and a live window replaces the observed one of the same id. The observations live in memory only and are empty after a restart. A rejected main-chat request (HTTP 429) is not observed, because pi-ai calls `onResponse` only for successful responses. The billing metadata carries the billing console URL (`CLAUDE_CONSOLE_URL`), linked only while requests bill to API credits. The subscription switch is offered for an OAuth sign-in, or when a Claude Code run has reported windows and no API-key sign-in stores the key. `createClaudeUsage.snapshot` drops a window whose reset time has passed, so an old `rejected` status does not prompt after its window reset.

`packages/llm/llm-pi-ai/src/claude-quota.ts:createClaudeQuotaSource`: the billing source follows the order pi-ai resolves a credential in: a profile `apiKeyEnv` (API credits), then the stored record (`api_key` is API credits, `oauth` is the subscription), then, only when neither exists, the ambient environment through the auth context (`ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY` are API credits, `ANTHROPIC_OAUTH_TOKEN` is the subscription). Before this, a route that relied on an environment key was listed as not set up, or as billing the subscription once a Claude Code run had reported windows, while its requests went to API credits. One record slot holds either an API key or the sign-in, so "both set up" means a sign-in record plus an `apiKeyEnv` reference whose key is stored; the result then carries the subscription windows and `billing.active: "api"`. A Console-account sign-in is stored as `oauth` but may bill API credits; the source cannot tell, which is why a spend-limit refusal under a subscription setting is reported (see `ApiLimitLine`).

`packages/llm/llm-pi-ai/src/adapter.ts:PiAiAdapterOptions.onRequestFailure` and `packages/llm/llm-pi-ai/src/index.ts:apply`: each failed request (an error `finish` chunk, or a thrown error) reports its message with its route. For the Anthropic route, `providerUsageLimitOf` recognizes the API usage-limit refusal and `ClaudeUsage.observeApiLimit` stores it, so `QuotaResult.apiLimit` carries the date access returns. A limit with a date lapses at that instant; one without a date is shown for `UNDATED_LIMIT_HOLD_MS` (24 h). The refusal is held in memory only.

`packages/llm/llm/src/provider-limit.ts:providerUsageLimitOf`: the parser the chat failure text (`packages/client/ui-chat/src/client/chat/MessageItem.tsx`) and the Host quota source share. It lives in `@deepseek-ai/dsh-llm` and is reached from the client through the `@deepseek-ai/dsh-llm/provider-limit` subpath, which is inline-safe for client bundles (`INLINE_SAFE` in `packages/client/tsdown.client.ts`) and pulls none of the package root. `regainAt` is set only for a `YYYY-MM-DD[ at HH:MM][ UTC]` date, read as UTC; any other wording keeps the text in `regainDate` alone.

`packages/client/ui-provider-quota/src/client/ProviderQuotaAction.tsx:ProviderSection`: a provider with a billing choice shows the subscription windows under the subscription heading and, when requests bill to API credits or a spend limit was seen, an API-credits heading. `SourceHeading` marks the source requests use (`inUseForRequests`). `ApiLimitLine` shows "API credits: spending limit reached until <date>", and adds a mismatch note when the limit was seen while billing is set to the subscription. Anthropic exposes no credit balance to an API key, so the credits section shows the limit status and the existing console link only.

`packages/subagent/subagent-claude-code/src/run.ts:consumeClaudeQuery`: each SDK `rate_limit_event` window is passed to `onRateLimit`. `packages/subagent/subagent-claude-code/src/index.ts:ClaudeCodeProvider` turns each one into an `llm/rate-limit-observed` event that the Claude source records.

`packages/client/ui-provider-quota/src/client/locales.ts:en`: copy names no provider. Provider, window, percent, time, and billing source are interpolated (`{provider}`, `{window}`, `{percent}`, `{when}`, `{source}`), and the zh and en dictionaries share one key set enforced by `Record<keyof typeof zh, string>`.

## Live activity under the running indicator

`packages/client/ui-chat/src/client/chat/live-activity.ts:liveActivity` reads the one in-flight operation from `ChatSnapshot.legacy`, which the Chat view already subscribes to, so no Session event, projection field or contract type was added. Precedence: the most recent running tool call (nested `subCalls` included), then streamed output, then a scheduled model retry, then an unsettled `/compact` command, otherwise idle.

`packages/client/ui-chat/src/client/chat/live-activity.ts:liveActivity` estimates streamed tokens as `ceil(characters / 4)` over the partial text and reasoning blocks (`CHARACTERS_PER_TOKEN`). It is an estimate for the current step, not provider usage, which arrives only when the step settles. The copy says "about ... tokens so far" (`chat.live.writingTokens`, `chat.live.thinkingTokens`).

`packages/client/ui-chat/src/client/chat/RunningStatus.tsx:RunningStatus` keeps the clock on the existing one-second interval and counts silence from the last change to the `legacy` slice; `INACTIVITY_HINT_MS` in `live-activity.ts` is 120 seconds. A streamed chunk updates `partial` in `packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts`, so a long stream does not show the hint.

`packages/client/ui-chat/src/client/chat/RunningStatus.tsx:useSince` restarts the generation clock when the `turn:step` key changes and the silence clock when the `legacy` object changes. It resets during render, so there is no extra effect or timer.

`packages/client/ui-chat/src/client/chat/RunningStatus.tsx:RunningStatus` does not show the hint while a question tool (`ask_user_question`, `request_user_input`) is running, because that wait is for the user and not a stall.

`packages/client/ui-chat/src/client/chat/RunningActivity.tsx:RunningActivity` renders the live line and the Stop hint. Stop calls the injected `stop`, which `packages/client/ui-chat/src/client/apply.ts:apply` wires to `session.cancel()`, the composer Stop verb. Nothing cancels a silent Turn on its own.

`packages/client/ui-chat/src/client/contract/process-groups.ts:activity` supplies the process label for a tool name, and `packages/util/values/src/index.ts:liveToolDetail` the one-line argument detail. Both were exported from their modules for this view and are otherwise unchanged.

`packages/client/ui-tool/src/client/tool/components/ElapsedClock.tsx:ElapsedClock` ticks once a second from `startedAt`, rendering m:ss and h:mm:ss after an hour. `packages/client/ui-tool/src/client/tool/models/tool-call-model.ts:toolRowModel` sets `startedAt` only while a call has no result, and `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx:ToolRow` shows the clock only when that value is passed and the row is running.

Not covered: a subagent's own step and last-activity time (the parent view has no child Session progress), a background job's progress (the job roster is not in ui-chat), automatic compaction before its checkpoint node lands, and approval waits. ApprovalPanel is driven by pending interaction state, not Chat nodes, so the hint can appear while an approval is pending.

## Session content search default and control

Full-text search over past session contents stays on by default in the web bundle. `packages/bundle/web-app/cordis.patch.yml` sets `session-query-sqlite` to `openAt: first-search`, and `packages/session-query/session-query-sqlite/src/config.ts:resolveConfig` defaults `contentSearch` to `true`. The base bundle keeps `openAt: never`, where search stays off whatever the toggle says.

`packages/session-query/session-query-sqlite/src/index.ts:SqliteSessionQueryEngine` reads `contentSearch` as a Volatile on each call. Turning it off makes `searchSessions` and `searchEvents` refuse at once (`SqliteSessionQueryEngine._assertSearchEnabled`). The index files are deleted in `SqliteSessionQueryEngine[Service.init]` at the next start, not while the process runs. Deleting a live index would have to close the SQLite handle, reset the shared generation and cursor state, and reopen on re-enable, and a stale cursor could then match a fresh generation. Turning it back on before a restart keeps the open index.

`packages/session-query/session-query-sqlite/src/schema.ts:removeIndexFiles` removes the database file and its `-wal`, `-shm`, and `-journal` sidecars; `:memory:` has none and is skipped. It first reads the file header and removes nothing unless the path is absent, empty, or a SQLite database whose application id is unset or this index's, so a mistyped `path` that names a notes file, a directory, or another application's database is left in place and the start logs a warning instead of failing.

`packages/client/ui-settings-general/src/client/index.ts:apply` registers the "Search session contents" General row only while the Host serves the `session-query-sqlite` namespace (`configForms.whileServed`). `packages/client/ui-settings-general/src/client/SessionSearchRow.tsx:SessionSearchRow` writes `contentSearch` through the shared config form and keeps the switch on when a write is refused.

Not implemented: a separate "Clear search index" action. The toggle is the only deletion control, and deletion waits for the next start.

## Team role routing

`packages/subagent/tool-subagent/src/index.ts:apply`: when Team mode is enabled, a subagent call with a role and no explicit model request resolves that role through `SessionController.teamRoleDefaultOf`. A configured route is validated and preflighted before child creation.

`packages/api/session-controller/src/index.ts:SessionController.teamRoleDefaultOf`: resolves the requested Team role from the Session's effective Subagent Setup or the global default. This is the Host entry point used by the subagent tool.

`packages/subagent/subagent-claude-code/src/run-selection.ts:claudeRunSelectionOf`: a per-run model must be a Claude Code alias (`sonnet`, `opus`, `haiku`, `fable`, `best`, `opusplan`, with `[1m]` on sonnet, opus, and fable) or a `claude-<family>-<n>[-<m>][-<yyyymmdd>]` id, so a date-suffixed id such as `claude-opus-4-5-20251101` is accepted, and an effort must be one of the five levels. Any other value throws before the run starts, and a run may set only model and effort.

`packages/client/ui-conversation/src/client/apply.ts:viewTabs`: the Trajectory view is listed whether or not developer tools are enabled. `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx:ConversationSession` keeps the tab strip on blank Sessions.

`packages/api/session-controller/src/run-options.ts:runOptionsValue`: a `subagentSetup` write is checked against the strict setup schema, and an invalid setup rejects the whole write. `subagentSetupOf` reads the nearest Session's setup up the parent chain, up to `MAX_SETUP_HOPS` (8).

`packages/api/session-controller/src/run-options.ts:installRunOptions`: the `session:subagent-policy` prompt section is added only while the setup is enabled and the `subagent` tool is in scope. Its text comes from `subagentPolicyText` and names only the configured delegation roles.

`packages/api/session-controller/src/run-options.ts:installRunOptions`: the `lean` and `minimal` presets mount no `subagent` tool, so the section is skipped there and their complete persona does not reference `{{subagent_policy}}`. A custom complete persona that mounts the `subagent` tool must reference it to carry the policy.

`packages/llm/llm/src/provider-limit.ts:providerUsageLimitOf`: a turn failure arrives as the provider's raw status and JSON body with no stable code, so the Anthropic spend-limit refusal (`invalid_request_error` whose message says "API usage limits") is recognized by text. `packages/client/ui-chat/src/client/chat/MessageItem.tsx:failureMessage` shows the readable copy with the regain date the provider wrote, and `TurnErrorItem` keeps the raw body in a collapsed `details` element. A coded failure keeps its own copy first, and other `invalid_request_error` messages stay raw.

## Repo gate fixes on the feature branch

`packages/client/ui-chat/src/client/contract/process-groups.ts:activity` lives in the contract layer and `packages/util/values/src/index.ts:liveToolDetail` in the shared util package, so `chat/live-activity.ts:liveActivity` reaches both without importing the `conversation-nodes/` domain. `verify-client-domain-graph` forbids a `chat/` file importing the sibling `conversation-nodes/` domain, and a contract file importing a domain would be the reverse violation.

`packages/experimental/hooks-codex/tests/bridge.spec.ts:agentFake` and `packages/api/terminal-controller/tests/cli-terminal.spec.ts:agentFake` take `Partial` fields and narrow once to `Agent`. `Agent` has nine required members beyond `id`, and `Session` is a class with private fields, so a literal can never satisfy it directly; `as unknown as` is no longer needed.

`packages/client/ui-sidebar-terminal/tests/cli-terminal-pane.client.spec.tsx:mount` types the injected terminal model as `Partial<TerminalView>` and narrows it only where `cli` returns it, leaving the literal `model` for assertions.

`packages/client/ui-model-selection/src/client/index.ts:apply` (`openCliTerminal`): the new CLI Session is created in the Workspace that holds the current Session, found with `ctx.get('workspaces')` rather than an inject entry so a bench without the Workspace service still runs. A Session created by `cwd` alone lands in Ungrouped. Reopening an unarchived CLI Session in the same page shows "Terminal closed", because `ClientTerminals.closeCli` keeps the stopped view registered; the pane header still offers Close.

## Memory page layout

`packages/client/ui-memory-workspace/src/client/MemoryPage.tsx:MemoryPage` builds the page from `@deepseek-ai/dsh-client-ui-primitives`: `SegmentedControl` is the Browse/Graph tablist (`role="tab"` controlling `memory-view-<tab>-panel`), `Input` carries the search field, `Button` covers Refresh, the pager and the filters, and `StateDot` maps server state (`ready` done, `starting` warning, `unavailable` error) beside the Retry button in the chat memory card. The filters stay `aria-pressed` buttons because they select a view rather than control a panel. The collection picker remains a native `<select>` because it has no primitive equivalent and the table tests query the combobox role. The page has no chat memory off switch; that lives in `packages/client/ui-settings-general/src/client/ChatMemoryRow.tsx:ChatMemoryRow`.

`packages/client/ui-memory-workspace/src/client/MemoryPage.module.css:.records` is a master/detail grid whose `.detail` pane is sticky and card-styled. Below 900px `@media (max-width: 900px)` stacks it under the list and the page itself scrolls. Each `.row` renders its type as a `Tag` and its project, status and date as text in `.rowMeta`; `aria-current` drives the selected accent in `.row[aria-current='true']`.

`packages/client/ui-memory-workspace/src/client/MemoryPage.tsx:MemoryPage` drops files onto the `label.drop` element by calling the same `upload` handler as the file input. `dragOver` and `drop` prevent the browser's default file open and `drop` ignores the event while `busy`. The drop zone label contains the file input, so click and keyboard activation keep their existing behaviour.

`packages/client/ui-memory-workspace/src/client/MemoryPage.tsx:MemoryPage` renders the details pane through `fieldLabel` and `fieldValue`: keys in `FIELD_KEYS` use the localized `field.<key>` entries in `locales.ts`, other keys are humanized from camelCase. Arrays and JSON-string arrays whose items are all strings render as a `ul`; anything else stays text. `instant` formats ISO timestamps (details pane and the status card) with `Intl.DateTimeFormat` using the `dateLocale` entry, and leaves non-ISO text untouched. The collection `<select>` is labelled `collection` so it does not share the Browse tab's name, and `dragOver` skips the highlight while `busy`.

`packages/client/ui-primitives/src/Input.tsx:Input` takes `className?: string | undefined`, matching `Button` and `Tag`, so a CSS-module class passes without a cast. `packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx:PluginManagerPage` passes `css.partsFilter` directly for that reason.

## Subagent route failures

`packages/subagent/tool-subagent/src/model-selection.ts:preflightChildLlmRoute` validates through `LlmRuntime.resolveCallConfig`, which checks the model, effort, and registered adapter only. It never resolves credentials. A missing key is detected at request time by `packages/llm/llm-deepseek-api-key/src/index.ts:apply` (`resolveApiKey`, code `MISSING_CREDENTIAL`), so a route without a key still starts its child and fails its first turn. Moving that probe into `packages/llm/llm-deepseek/src/adapter.ts:DeepSeekAdapter` `prepareCall` was rejected: `packages/core/agent-loop/src/agent.ts:prepareRequest` calls `prepareCall` on every step, and routes served by `llm/stream` middleware would then fail before the middleware runs (six cases in `packages/llm/llm-deepseek/tests/account-routing.spec.ts`). A credential-only query needs an `LlmAdapter` hook in `packages/llm/llm/src/index.ts:LlmRuntime`, which is over the 750-line cap.

`packages/api/session-controller/src/catalog.ts:missingCredentialProviders` is the one credential signal for "this provider cannot run". A provider is flagged only when its settings profile names an `apiKeyEnv` that is a valid credential reference and `credentials.describe` reports it unconfigured. Providers that name no key (pi-ai's ambient or OAuth routes), the `deepseek-account` route, malformed names, and unreadable states are never flagged. The signal is exact because `packages/llm/llm-pi-ai/src/adapter.ts:PiAiAdapter` calls `resolveApiKey` on every `stream`, and a named reference that misses fails with `MISSING_CREDENTIAL` before any auth decision. `packages/llm/llm-deepseek-api-key/src/index.ts:apply` has the same rule.

`packages/api/session-controller/src/catalog.ts:buildModelCatalog` sets `missingCredential: true` on a flagged `ModelProviderGroup` (`packages/api/session-controller/src/types.ts:ModelProviderGroup`) and leaves `routableProviders` unchanged. The flag was chosen over dropping providers from `routableProviders` because the main model picker reads `groups` and never `routableProviders`, so dropping would change nothing there. The Subagent Setup view needs the group flag to label a fixed route that points at a flagged provider.

`packages/subagent/subagent/src/failure-diagnostic.ts:failureDiagnosticOf` returns the message of a child's last `turn/end` whose reason is `error`, masks Bearer tokens, `sk-` keys and `api_key`/`token`/`password`-style assignments (no shared free-text redactor exists; the session telemetry and settings redactors are structural), then cuts to 1024 UTF-16 units without splitting a surrogate pair, at most 3072 UTF-8 bytes, inside the 4096-byte `SubagentResult.diagnostic` contract. `captureLocalResult` attaches it only when the stop reason is `error`, so a cancelled child has no diagnostic and stays `killed` in `packages/subagent/tool-subagent/src/index.ts:runOutcome`. `packages/subagent/subagent/src/activation.ts:captureLocalResult` attaches it to foreground results, so `packages/subagent/tool-subagent/src/index.ts:stopReasonError` surfaces it as `Diagnostic:` beside the partial output.

`packages/subagent/subagent/src/lifecycle.ts:createActivationObserver` stores it on `ActivationTerminal.diagnostic`, and `packages/subagent/subagent/src/continuation-messages.ts:createSettlementMessage` writes it as `Its failure:`. A continuable call returns before its child runs, so the settlement notice is the only place the parent can read the failure.

## GSD workflow skills

`packages/skill/skill-gsd/src/index.ts:apply` registers the twenty `gsd-*` candidates at the bundled rank and reads each `SKILL.md` frontmatter at activation. A skill whose declared `name` differs from its directory fails activation, so the directory name is the `/` command. The provider has no configuration; its resource base is the packaged `assets/` directory.

`packages/skill/skill-gsd/src/index.ts:parseSkill` reads `name` and `description` with line regexes rather than a YAML parser, so each description must be one plain line with no `: `. `packages/skill/skill-gsd/tests/skill-gsd.spec.ts` enforces both rules.

Per-Session gating is not implemented. A provider's `list()` receives only `cwd` and an abort signal, with no Session identity, so a provider cannot list the skills only while a Session's GSD setting is on. The skills read the settings from their instructions instead, and the catalog lists twenty entries in every session.

`packages/skill/skill-gsd/assets/shared/settings.md` holds the defaults (`every-step`, `orchestrator`, `commit`, `2`, `true`) used when a session carries no GSD section. `packages/skill/skill-gsd/tests/skill-gsd.spec.ts` fails if any skill writes a gate mode as a fixed value or a gate-bearing skill stops naming the `gates` setting.

`packages/skill/skill-gsd/assets/shared/conventions.md` tells coders to stage explicit paths, add no trailers, and retry an index lock rather than delete it. Parallel waves use no worktrees because the `subagent` tool has no isolation parameter, so plans in one wave need disjoint `files_modified`, and git's index lock serialises their commits.

`packages/skill/skill-gsd/assets/gsd-ship/SKILL.md` asks before every push or pull request under every setting, because those leave the machine, and it never merges. `packages/skill/skill-gsd/assets/gsd-autonomous/SKILL.md` stops before ship for the same reason.

`packages/skill/skill-gsd/assets/templates/plan-result.md` is named away from `SUMMARY.md` because the harness refused a subagent write of a file with that name as a report. The output file keeps the upstream name `<NN>-<PP>-SUMMARY.md`.

`packages/skill/skill-gsd/tests/skill-gsd.spec.ts` upstream-token test was revert-proofed by appending `gsd_run` and `AskUserQuestion` to `packages/skill/skill-gsd/assets/gsd-help/SKILL.md`: the test failed and named that file, and it passed again once the file was restored.

## GSD workflow settings and global default

`packages/api/session-controller/src/index.ts:SessionController.defaultSubagentSetup`: the global default is a volatile `subagentSetup` field on the existing `session-controller` settings entry, so no new entry or settings card is needed. The settings layer validates a plugin Config only through schemastery, which cannot express the strict zod schema, so the field is `z.any().volatile()` and `defaultSubagentSetup` parses it with `subagentSetupSchema` on every read. An invalid stored value is ignored, so it behaves as no global default; the settings layer does not reject it at write time. The warning is logged once per stored value (`warnedSubagentSetup` compares the frozen volatile snapshot by identity), because every prompt assembly and every tool call resolves the setup.

`packages/api/session-controller/src/run-options.ts:installRunOptions`: the `session:gsd-workflow` section is added only for top-level Sessions. `gsdWorkflowFor` returns empty when the header origin is `subagent`, so a child agent never receives the orchestrator loop. The gate keys on origin, not `parentSession`, so a fork that carries a parent link keeps the workflow. It also needs the `subagent` tool in scope, like the policy section, so the lean and minimal presets get no workflow text they cannot act on; `{{gsd_workflow}}` is the variable for complete personas.

The session panel's "Using global defaults" line does not link to the Settings page. `packages/client/ui-settings-general/src/client/SettingsRoot.tsx:SettingsRoot` opens a section only from its launcher props (`openSection`), and no service lets another plugin open a section, so a link needs a navigation API first.

`tsconfig.base.json`: the `@deepseek-ai/dsh-client-ui-settings/client` and `@deepseek-ai/dsh-client-ui-plugin-manager/client` aliases were added by hand, and `gen-tsconfig-paths --check` passes with them.

`packages/api/session-controller/src/agent.ts:ApiSessionAgentController.selectionFor`: the request path. Its `current` getter returns the orchestrator route before the stored pick, so prompt assembly and the request config set by `installModelSelection` both use it on every step. The getter is read at each assembly, so a saved global default reaches a running Session on its next step, and the model-change notice is added when the route changes. The Session log gets no `model/selection` event, so turning the setup off returns the Session to its pick. The projection cannot carry this route: `modelSelection` is a pure fold of Session events, and the default is a volatile config outside them.

`packages/api/session-controller/src/run-options.ts:sessionModelOf`: reports the same route, so the Ultracode check reads the model the Session will run.

`scripts/gen-third-party-notices.ts`: open item. DECISIONS asked for an "Adapted prompt content" entry in `THIRD_PARTY_NOTICES.md`, which is generated. The generator is over 750 lines, so the entry waits for its renderer to be split; `packages/skill/skill-gsd/NOTICE-GSD.md` carries the full MIT text meanwhile.

`packages/skill/skill-gsd/assets/shared/settings.md`: `checkRounds` 0 means each plan check and verification runs once with no fix round, matching `subagentWorkflowText`; it does not skip the check. `packages/skill/skill-gsd/assets/gsd-ship/SKILL.md` asks before the push under `auto` too, because ending the turn without a question left no way to ship under `auto`. `packages/skill/skill-gsd/assets/shared/conventions.md` tells the orchestrator to turn relative asset paths in a brief into absolute paths, since a child has no skill base directory, and states the `info/exclude` rule for `planning: local` once for every skill.

`apps/desktop/scripts/package-target.ts:desktopElectronBuilderEnvironment`: sets `pnpm_config_filter=.` for every electron-builder run. Under pnpm 11, `pnpm list --prod --json --depth Infinity` from `apps/desktop` prints all 348 workspace projects and marks a package "deduped" wherever it was already printed under another project. electron-builder 26.15.3's `PnpmNodeModulesCollector` could not resolve the deduped `debug@4.4.3` under `electron-updater > builder-util-runtime` ("unresolved duplicate dependency references") and left `debug` and `ms` out of `app.asar`, so the installed 0.2.0-rc.1.20261015.1 build crashed at start with "Cannot find module 'debug'". With the filter, pnpm lists only the desktop project, and the full tree is collected.

`apps/desktop/src/project-manager.ts:createRuntimeProjectMetadata`: the desktop installer runs its own pnpm install from the workspace file it generates here, not from the repository root `pnpm-workspace.yaml`, so the `@deepseek-ai/libreoffice-kit>fflate` security override (`RUNTIME_SECURITY_OVERRIDES`, GHSA-px8p-9vwx-vf98) must be passed to `workspaceFile` as well or the shipped runtime keeps fflate 0.8.2. It is kept out of the map from `desktopCorePackageOverrides`, because that map is also the runtime manifest's `dependencies`, and fflate is not a direct dependency.

`packages/client/ui-primitives/src/markdown/katex.tsx:renderTexToReact`: both `katex.renderToString` calls pass `trust: false` explicitly. KaTeX reads each option as `options[prop]` with no own-property check (`src/Settings.ts` `applySetting`), so an inherited `Object.prototype.trust = true` (GHSA-238p-pmpm-9mq7, prototype pollution) would enable `\href{javascript:...}` links when the key is omitted. The regression test is the `inherited trust flag` case in `packages/client/ui-primitives/tests/markdown.client.spec.tsx`.

`packages/client/ui-subagent/src/client/ClearedSubagents.tsx:useClearedView`: Clear finished hides a parent's finished direct children from the catalog menu and its count, and Show cleared lists them again so their conversations stay readable. Running children and the open child (the switcher's current entry) never hide, so a cleared child that is continued reappears while it runs. The cleared ids live in `localStorage` under `dsh.subagent.cleared.v1:<parentSessionId>`; a Host-side record would carry them across browsers, but no Host state is needed for a menu preference. `packages/client/ui-subagent/src/client/catalog-format.ts` holds the row formatting helpers moved out of `SubagentHeaderLineage.tsx` to keep that file under the 750-line limit. Test: `packages/client/ui-subagent/tests/cleared-subagents.client.spec.tsx`.

`packages/llm/llm-pi-ai/src/reasoning-payload.ts:shapeReasoningPayload`: pi-ai builds the request body from its own defaults, which differ from the provider's, so every call's body is rewritten after pi-ai builds it. An unrequested level (Default) must never send a disabled or none value. Anthropic adaptive models (`compat.forceAdaptiveThinking`, which includes Claude 5.5) keep adaptive thinking and drop `output_config`, because an omitted effort is the model default (medium on Opus and Haiku 5.5, high otherwise); pi-ai otherwise sends `thinking: disabled` or a hardcoded effort `high`. The mid-conversation effort message pi-ai appends is rewritten to the requested level, or removed for Default, and earlier turns keep their recorded effort. Manual-budget Anthropic models (4.5 and earlier, with no `forceAdaptiveThinking`) drop `thinking` for Default: the documented default is thinking off, so this turns nothing off that the provider would have on. OpenAI Responses drops `reasoning` for Default instead of sending `none`. Codex keeps the `reasoning` object with only `summary: "auto"`, because the Codex route sends that object on every request. DeepSeek chat-completions (`compat.thinkingFormat: deepseek`) drops `thinking` for Default, since DeepSeek thinks by default. An explicit `off` is passed through unchanged, so it still disables thinking or sends none. Sources: https://docs.anthropic.com/en/docs/build-with-claude/effort, https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking, https://platform.openai.com/docs/guides/reasoning, https://api-docs.deepseek.com/guides/thinking_mode, https://opencode.ai/docs/go/.

`packages/llm/llm-pi-ai/src/adapter.ts:PiAiAdapter` (`streamWithSnapshot`): the `onPayload` hook is now always installed, so the resolved level reaches `shapeReasoningPayload` on every call. The service-tier rewrite that a declared model mode installs is merged into the same hook, applied before the shaping. The level passed is the one `resolveReasoningLevel` validated, so Default arrives as `undefined` and an explicit `off` as `off`.

`packages/llm/llm-pi-ai/src/models.ts:getSupportedThinkingLevels`: `minimal` is offered only where it is distinct from `low`. Anthropic effort has no minimal level (it sends `low`), and Codex maps minimal to `low`, so neither offers it; the adapter then refuses an explicit minimal before any request. Anthropic manual-budget models also lose `minimal`, although its 1024-token budget differs from `low`; this is a deliberate single rule for the whole Anthropic family. OpenAI and DeepSeek catalogs already withhold minimal through `null` mappings. Sources: https://docs.anthropic.com/en/docs/build-with-claude/effort, https://platform.openai.com/docs/guides/reasoning, https://opencode.ai/docs/go/.

`packages/llm/llm-deepseek/src/serialize.ts:serialize`: native DeepSeek Messages already sends the documented wire fields: the default is `high` (thinking enabled, `output_config.effort: high`), `low`, `high` and `max` pass through, `off` disables thinking, and `medium` is refused before the request, because DeepSeek maps medium to high and the picker does not offer it (`catalogModelInfo` / `modelInfo` list only off, low, high and max). The `tests/reasoning-wire.spec.ts` cases guard this mapping and did not need a change. Sources: https://api-docs.deepseek.com/guides/thinking_mode, https://docs.anthropic.com/en/docs/build-with-claude/effort.
## Hooks settings page

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection`: one card per report in the snapshot. Bridge reports (those with `settingsNs`) get switches and the bulk and description controls. External reports (Codex and Claude settings files, no `settingsNs`) render read-only, with their status, read error, skipped entries and commands. The README promised external commands and read failures on this page, and `packages/host/plugin-inventory/src/index.ts:readPluginInventory` already returns them, but the page dropped every report without `settingsNs`. An earlier test asserted the hiding; it now asserts the README behaviour. To restore hiding, filter external reports in `visible` and update the README and that test together.

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:groupByCommand`: rows group by the exact command string, not by `hookName`. Grouping by script name merged unrelated commands (`npx prettier --check` and `npx eslint .` both named `npx`) under one switch, so one toggle disabled both. Each row's keys are every handler of that command, across events and matchers, which is what its switch writes.

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection`: the row id, the editor state and the details state key on dialect, source, `settingsNs` and command. The description editor used to key on dialect and name, so two bridges of one dialect that loaded a hook with the same name opened the editor in both.

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:matcherOf`: an empty matcher is the match-all sentinel (`packages/experimental/hook-protocol/src/matcher.ts:matchesMatcher`), so it is not printed as `()`.

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection`: the matcher line shows the first three `|` alternatives and `+N more`; the full matcher is in the row's `title` and in Details. The count and the matcher summary are display only. Matching uses the configured pattern (`matchesHookSubject`).

`packages/experimental/hooks-codex/src/index.ts:apply` and `packages/experimental/hooks-claude-code/src/index.ts:apply`: the bridge reads `enabledHooks` and `hookDescriptions` through their Volatile references on every dispatch (`enabledHooks()` inside `runPoint`), so a switch takes effect on the next matching event without a restart. A Settings write (`packages/settings/settings/src/index.ts:mutate`, which writes through `configEditor.edit`) reaches those references through `vendor/loader/src/config/entry.ts:_commitVolatile`, which updates volatile values in place for an active fiber. Verified by reading the code; no end-to-end test drives a live toggle through the loader.

`packages/host/plugin-inventory/src/index.ts:readPluginInventory`: each `list` call emits `hooks/inventory` and rereads the external files (`packages/host/plugin-inventory/src/hook-files.ts:readHookFiles`, no cache), so Refresh shows the current file and bridge state. A bridge report wins over an external file with the same dialect and source.

`packages/client/ui-subagent/src/client/locales.ts:effort.default` labels a role's Default effort "Inherited or model default", because Default does not always inherit. An LLM role on the parent's own provider and model keeps the parent's reasoning effort through `packages/subagent/subagent/src/child-agent.ts:resolveChildAgentOptions`; on any other route that effort is deleted, so the model default applies. A Claude Code role takes the Session run-option effort at `packages/subagent/subagent-claude-code/src/index.ts:start` (`selection.effort ?? runOptions?.effort`) when one is set, and otherwise the Claude Code CLI default. Making Default mean model default everywhere would need a role-request flag through `resolveChildAgentOptions` and the Claude Code provider's `start`.

`packages/subagent/subagent-claude-code/src/run-selection.ts:EFFORT_LEVELS` is pinned equal to `SESSION_RUN_OPTION_EFFORTS` by `packages/subagent/subagent-claude-code/tests/run-selection.spec.ts:claudeRunSelectionOf` (the "accepts exactly the Session run-option effort levels" test). The subagent-claude-code package has no runtime dependency on the session controller, so the list is kept equal by test rather than imported. Per-model filtering of Claude Code effort levels is out of scope.

`packages/client/ui-theme/src/styles/design-platform.css:body[data-ds-dark-theme]`: the dark palette uses warm neutral static steps (`--dsw-static-neutral-warm-*`, declared in the shared `body` block) to match Claude Desktop's dark mode, instead of the blue-gray `neutral-bluish` steps. The canvas is warm 900 (26, 26, 25) and the sidebar is warm 950 (18, 18, 17), so the sidebar is now darker than the canvas, the reverse of the old ordering; that follows the requested target values. Text steps were raised for readability: tertiary on the canvas measures 9.55:1 and caption on layer-2 measures about 5.95:1 (WCAG). `label-dimmed` moved from bluish 750 to warm 600 (130, 128, 120), which measures 4.40:1 on the canvas, below 4.5:1, by design as the dimmest label. Light-mode values and the existing static tokens are unchanged. The first-paint canvas in `packages/client/ui-theme/src/boot-theme.ts:DARK_BACKGROUND` and the dark think gradient in `packages/client/ui-theme/src/styles/gradient-shadow-text.css` use the same canvas colour.

`packages/client/ui-chat/src/client/conversation-nodes/process-activity.ts:processActivity`: each category keeps the distinct basenames of its `file_path` in first-call order, and only read, readImage, write and edit have targets. Line totals come from `diffTotals`. A settled write or edit uses its applied `meta.diffs` when they validate, else the call's own arguments, so a whole-file write counts every line as added. Errored calls still count as calls and keep their targets, but add no lines. Two files with the same basename in different folders collapse into one target, while the call count still reflects both calls. `str_replace_editor` has no category of its own and falls into `tools`, so its lines are not totalled.

`packages/client/ui-chat/src/client/chat/step-process.ts:processTitle`: a category with one call and one target names that file (`Read`, `Viewed`, `Created`, `Edited`). Every other category states its count, and the Chinese labels for one call no longer start with `已`. The shared-prefix collapse therefore applies only if a future label starts with `已`, and mixed labels never produce `并已`.

`packages/client/ui-chat/src/client/presentation-policy.ts:ChatPresentationPolicy`: `groupedReasoningRows` is false in Compact and Standard, so the Think row inside a process group disappears and the group header (title and live detail) carries the reasoning. Detailed and Verbose keep those rows. Reasoning outside a group is not affected.

`packages/client/ui-chat/src/client/chat/AssistantMarkdown.tsx:AssistantMarkdown`: applies `groupedReasoningRows` only to the `reasoning` group part, which exists only inside a process group. The shell check still counts a reasoning-only block as visible, so a Compact or Standard group whose only member is reasoning still renders an empty member wrapper (spacing not checked in a browser).

`packages/client/ui-chat/src/client/chat/ChatGroupSeat.tsx:ProcessGroupHeader`: the diff stat appears only for a closed group with a nonzero line total, after the title inside the disclosure button, so a screen reader hears it as part of the group's name.

## OTLP exporter-base 0.222 metrics argument

`packages/telemetry/otel/src/transport.ts:createLogExporter` and `packages/telemetry/otel/src/event-transport.ts:createEventLogExporter`: `@opentelemetry/otlp-exporter-base` 0.222.0 requires a metrics object for each export delegate; 0.220.0 had none. Both pass `LogsExporterMetricsHelper` with an `undefined` meter provider, so the exporter self-metrics go to the no-op meter and nothing new is emitted, as before. The `otlp_http_log_exporter` label only names the internal counter and does not change the payload. `createLogExporter` keeps the SDK retrying transport through `createOtlpHttpExportDelegate`, as 0.220.0 did; `createEventLogExporter` still passes its own got-based transport to `createOtlpNetworkExportDelegate`, which does not wrap it in the SDK retry, so its retries stay the got `retry` options.

`scripts/release/unzip.ts:extractZip`: replaces `extract-zip` 2.0.1, which has no fixed release for GHSA-7pqw-9j4j-h8q3 (a symlink entry followed by a file entry under it writes outside the destination) and GHSA-jmr9-qjv8-65gv (unvalidated symlink path traversal). The helper reads with `yauzl` in lazy-entry mode and, before any file or directory is written, `lstat`s every path component from the destination down to the entry; an existing symlink component is refused, so no write ever follows a link, including one already present in the destination. A symlink entry is accepted only when its target is relative and resolves inside the destination from the link's own directory; absolute targets and drive-letter targets are refused. Entry names are checked again after resolution, though yauzl's `validateFileName` already rejects `..`, absolute, drive-letter and backslash names before the helper sees them. `onEntry` runs first for every entry, so a throw aborts extraction, and `__MACOSX/` entries are skipped as `extract-zip` did. Modes follow the archive's Unix attributes and are applied with `chmod` only off win32; the `extract-zip` defaults for zero-mode entries (0644 files, 0755 directories) are not reproduced, so such entries take the umask default. Write-through checks are a path check rather than a race-free `openat` chain, which is acceptable for a freshly created release directory.

`scripts/release/unzip.spec.ts:extractZip`: archives are built with `fflate` `zipSync`. Symlink creation returns EPERM on Windows without developer mode, so the relative-symlink case skips there. The write-through guard is covered on every host by a pre-planted link, which is a junction on win32 because junctions need no privilege. Rejections of `..`, absolute and symlink-escaping entries happen before any link is created, so those cases run everywhere. Revert check: removing the `assertNoSymlinkBetween` call fails the pre-planted-link case, and additionally removing the symlink target check with a junction-backed naive symlink fails the symlink-escape cases including `link -> ..` followed by `link/pwned.txt`.

## Running one-shot subagent steer, queue and Stop

`packages/client/ui-subagent/src/client/index.ts:selectReadOnlySubagent`: a one-shot child keeps the read-only composer only while its owner session is not running. While it runs the default composer owns the seat. A running one-shot whose parent is unavailable also keeps the default composer, so its Stop stays reachable, matching a continuable child.

`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:InputBar`: `continuable` is true for a running one-shot child, so steer, queue, the parent-offline lock and the independent Stop button all apply through the same gates the continuable path uses. `busyEnterMode` forces the busy-Enter preference to steer for a one-shot child, so the Send label and plain Enter say steer; the accelerated chord still submits `queue`, which the host's one-shot path also delivers at the next step.

## Windows ACL hard-link propagation

`packages/sandbox/sandbox-windows-acl/src/acl.ts:grantWrite`: one SetNamedSecurityInfoW on a workspace root propagates the capability ACE, the ambient-delete deny and the Low label to every descendant. NTFS keeps one security descriptor per file object, so a file hard-linked into the pnpm store (link count above 1) carried the grant too: programs launched from it ran at Low and failed, and the sandbox could write the shared store copy. The grant now snapshots every multiply-linked file under the root before the apply and restores it right after, so its descriptor never changes. Such files are not writable inside workspace-write, a deliberate trade-off. The exact-state skip also requires `linkedClean`, so the first grant after an upgrade re-applies once and repairs roots stamped by the old build.

`packages/sandbox/sandbox-windows-acl/src/acl.ts:revokeWrite`: snapshots and restores the same files around its apply. It neither reads nor writes the completion marker.

`packages/sandbox/sandbox-windows-acl/src/acl.ts:mergeAndApply`: restores the linked files immediately after SetNamedSecurityInfoW returns, whether or not it succeeded, because a failed apply can already have propagated. Restore failures are thrown afterwards as one Error naming every path. When the apply itself failed, only the apply error is reported; the marker is not written, so the next grant repeats the snapshot and restore.

`packages/sandbox/sandbox-windows-acl/src/acl.ts:snapshotLinkedFiles`: finds multiply-linked files with `multiLinkFiles` (readdir plus lstat). Symbolic links, including junctions as Node reports them, are not followed: propagation does not reach a junction target (probe: target untouched), and following one would snapshot files outside the root. Each file's DACL and label are read with GetFileSecurityW into a 64 KiB buffer. A failed read throws before anything is applied, so the grant fails closed. A file already stamped by an earlier build is snapshotted through `stripStamp`.

`packages/sandbox/sandbox-windows-acl/src/acl.ts:stripStamp`: removes only what propagation added for this sandbox: an inherited Allow ACE carrying `GRANT_MASK` for this root's capability SID, and an inherited mandatory-label ACE naming Low. Explicit ACEs and other inherited ACEs stay. If the strip would leave a DACL with no entries, it throws rather than restore a deny-all DACL that would lock out the file. Residual: propagation replaces a file's inherited ACEs with the root's set, so the inherited ACEs a store file received from its own directory are gone from files stamped before the fix, and repair cannot recover them.

`packages/sandbox/sandbox-windows-acl/src/acl.ts:restoreLinkedFiles`: writes each snapshot with SetFileSecurityW(DACL|LABEL). Path-based SetNamedSecurityInfoW was rejected for the restore because it sets SE_SACL_PROTECTED as a side effect. SetFileSecurityW restores the DACL bytes exactly, removes the label, and does not re-derive inherited ACEs from the still-stamped parent. Probe-observed side effects: SE_DACL_AUTO_INHERITED is dropped and SE_SACL_PRESENT is set, which is cosmetic. Failures are collected so one bad file does not stop the others; the enclosing withPathLock releases the lock on the error path.

`packages/sandbox/sandbox-windows-acl/src/acl.ts:linkedMarkerPath`: the completion marker is the per-path lock file name with a `.linked` suffix under `<GetTempPathW>\dsh-acl-locks`. It means no multiply-linked file under this root carries the sandbox stamp as of the last check. `grantWrite` removes it before every applying grant, so a crash mid-apply triggers repair next time, and writes it only after the apply and the restores succeed. A restore failure therefore leaves it absent and the next grant retries.

`packages/sandbox/sandbox-windows-acl/src/acl.ts:linkedClean`: the exact-state skip is safe only once the marker says the root is clean. When the marker is absent, the first call walks the tree. If any multiply-linked file exists the skip is refused and the full path repairs it (that path walks again inside `snapshotLinkedFiles`, once per repair). Otherwise the marker is written so later starts skip without walking. Probe costs on 5,000 linked files: lstat walk about 294 ms, GetFileSecurityW snapshot about 441 ms, propagation apply about 746 ms, SetFileSecurityW restore about 522 ms.

`packages/sandbox/sandbox-windows-acl/src/ffi.ts:Win32Bindings`: adds GetFileSecurityW and SetFileSecurityW bindings for the snapshot and restore. The `needed` out-parameter is a uint32 slot from `allocUint32`.

`packages/sandbox/sandbox-windows-acl/tests/acl-linked-files.spec.ts:hard-linked files under a granted root`: real Win32 on fresh mkdtemp trees under os.tmpdir(), Windows only. The already-stamped case reproduces an earlier build by making the first grant's restore a no-op, then clears the marker and grants again. The failed-restore and failed-snapshot cases assert the lock is released through unlockFileEx, because a second LockFileEx from the same thread would block on the held lock instead of failing.

`packages/sandbox/sandbox-windows-acl/tests/runner.spec.ts:windows-acl runner`: the workspace hard-link case now expects the sandboxed write through the link to be denied (EPERM or EACCES) and the external file to stay `original`. Before this fix the same test asserted the external file was mutated.

`packages/sandbox/sandbox-windows-acl/assets/diagnose-windows-sandbox-acl/scripts/diagnose-windows-sandbox-acl.ps1:SetDacl`: a second propagating path not covered by the TypeScript fix. Its P/Invoke SetNamedSecurityInfoW sets the DACL with the UNPROTECTED flag (0x20000000) unless protection is requested, which re-propagates inheritance to children, hard-linked files included. It runs only as the diagnosis skill on a requested path inside -AllowRoot, so grant and revoke never reach it. Covering it needs a PowerShell port of the snapshot and restore, which would take the script past the 750-line budget; left open for a decision.

## Pwsh command text off the command line

`packages/shell/pwsh-local/src/index.ts:PwshLocalExecutor.argv`: on Windows the command runs as `pwsh ... -ExecutionPolicy Bypass -File <script>` instead of `-Command <text>`. Windows Defender flags every agent PowerShell process whose command line carries a long inline `-Command` script (`Trojan:Win32/FileFix.BBA!MTB`), so on Windows the text lives only in a per-execution `command.ps1`. `-EncodedCommand` was rejected because it is a stronger malware signal. `-ExecutionPolicy Bypass` is passed because Windows PowerShell 5.1 (the fallback in `packages/shell/pwsh-local/src/resolve.ts:resolvePwshPath`) defaults to `Restricted` on client Windows, which refuses a `-File` script.

`packages/shell/pwsh-local/src/index.ts:PwshLocalExecutor.argv`: off Windows the argv is the original `-Command` form, unchanged, and writes no file. The script file is Windows-only because Defender does not run elsewhere, and on Linux a `-File` script under `/tmp` is invisible to a bwrap-confined pwsh: `packages/sandbox/sandbox-local/src/profiles.ts:bwrapProfileArgs` mounts a private tmpfs over `/tmp` in workspace-write.

`packages/shell/pwsh-local/src/index.ts:PwshLocalExecutor.argv`: the Windows script is written with a UTF-8 byte-order mark. Windows PowerShell 5.1 reads a BOM-less `-File` script in the ANSI code page, which garbles non-ASCII text; the same precedent is `packages/util/native-command/src/file-applications-windows.ts`. The preamble stays on line 1 and the epilogue starts on a new line after the command, so user error line numbers are unchanged.

`packages/shell/pwsh-local/src/index.ts:PwshLocalExecutor.argv`: the Windows script directory is `os.tmpdir()`. The Windows ACL runner is a WRITE_RESTRICTED token and leaves reads unconfined (`packages/sandbox/sandbox-windows-acl/src/token.ts:createRestrictedToken`, `packages/sandbox/sandbox-windows-acl/src/index.ts` header), so a confined `pwsh` reads the parent-written script. `packages/shell/pwsh-sandbox/tests/acl.e2e.ts` runs a real confined command through it.

`packages/shell/pwsh-local/src/index.ts:EXIT_STATUS_EPILOGUE`: on Windows, `-File` exits 0 after a failed last statement (a non-terminating `Write-Error`), where `-Command` exited 1, so the epilogue exits with `$LASTEXITCODE` when `$?` is false and 1 otherwise. Ceiling: `$LASTEXITCODE` is not reset per command, so when a native command failed earlier and the last statement is a non-native failure, the earlier native code is returned instead of 1. A failed native last command keeps its own exit code, as `-Command` did.

`packages/shell/pwsh-local/src/index.ts:PwshLocalExecutor.removeScript`: the script directory is removed on every settlement path that follows a Windows `argv`: the `done` promise settles through `.finally` (normal exit, non-zero exit, deadline timeout, `kill()`, abort, provider rejection, a synchronous spawn throw, and a preparation timeout whose process never starts), and `executeArgv` removes it directly when confinement preparation throws before a process exists. With no script written (off Windows) it is a no-op. Removal swallows its own error so a file held open by a scanner cannot reject a settled execution; that leftover is reclaimed by OS temp cleanup. The directory is keyed by the spec object, so one spec must not be executed twice concurrently.

`packages/shell/pwsh-local/tests/executor.spec.ts:onPlatform`: stubs `process.platform` around the synchronous argv computation, so the win32 and non-win32 argv branches of `PwshLocalExecutor.argv` are unit-tested on every host without pwsh. `packages/shell/pwsh-local/tests/capturing-subprocess.ts:CapturingSubprocessRuntime` records spawn specs and `-File` script bytes; it lives in its own module so `executor.spec.ts` stays within its line budget.

`packages/shell/pwsh-local/tests/script-file.spec.ts`: win32-only real-pwsh checks for non-ASCII round-trip, the exit statuses (`exit 3`, a failing `Write-Error`, a native `exit 4`), and removal after timeout and kill.

`packages/shell/pwsh-sandbox/tests/sandbox.spec.ts:SandboxPwshExecutor`: the argv assertion checks the script path on win32 and the `-Command` tail elsewhere; the confinement-refusal removal test is win32-only. `packages/shell/pwsh-sandbox/tests/acl.e2e.ts` now registers `SessionProjectionRegistry` before `LocalSandboxProvider`; without it `ctx.shell` was never registered and the real ACL suite could not run.

`packages/shell/tool-pwsh/src/index.ts:pwshDescription`: the model-facing description names the temporary script file on Windows, mirrored in `packages/shell/tool-pwsh/README.md` and the pwsh-local and pwsh-sandbox READMEs.

`packages/api/terminal-controller/src/cli-profiles.ts:cliStartupArgv`: the interactive terminal startup still passes `profile.command` through `-Command`. It is an interactive profile command, not agent text, so it is outside this change.

## Claude Code prompt hooks

`packages/experimental/hooks-claude-code/src/prompt.ts:askModel`: a prompt hook is one tool-less model call through `ctx.llm.stream` with `temperature: 0`. It is not an agent step, so it writes no session event, runs no tool and fires no tool hooks, and a hook cannot re-enter itself.

`packages/experimental/hooks-claude-code/src/index.ts:promptRoute`: the model is the hook's `model` when that model resolves on the route's provider, and otherwise the calling agent's model with a warning. The route comes from the session's last request header, falling back to the agent's options. DSH has no background or small-model setting, so there is no third tier. A missing provider or model fails open.

`packages/experimental/hooks-claude-code/src/index.ts:evaluatePrompt`: each call runs under `AbortSignal.timeout` (the hook's `timeout` in seconds, else `PROMPT_HOOK_TIMEOUT_MS`, 30 s) combined with the caller's signal. A timeout reports `timed out after N ms`, any other failure reports its message, and both log a warning and allow the action.

`packages/experimental/hooks-claude-code/src/index.ts:evaluatePrompt`: when the model call fails, the failed record has no `exitCode`, carries the message in `stderr`, and records `decision: 'pass'`. That is the protocol's shape for a run that could not produce output, so the record reads as a passing hook with a message rather than a new failure state.

`packages/experimental/hooks-claude-code/src/prompt.ts:readReply`: a reply counts only when its stream ends with a terminal `finish` of kind `stop`. An `error` or `aborted` finish, `max-tokens`, any other finish kind, and a stream with no finish each fail open with the reason in the record.

`packages/experimental/hooks-claude-code/src/prompt.ts:parseVerdict`: the verdict is the first JSON object in the reply, found by a string-aware brace scan, so prose around it does not break parsing. `ok` must be a boolean. `impossible` counts only when it is `true`.

`packages/experimental/hooks-claude-code/src/prompt.ts:verdictOutput`: an `ok:false` verdict always denies (`decision: 'deny'`, reason as `reason`). It also sets `continue: false` with the reason as `stopReason`, which ends the turn through the existing cancel path, for UserPromptSubmit, for PreToolUse and PostToolUse unless `continueOnBlock` is true, and for Stop when `impossible` is true. Stop without `impossible` steers, and SubagentStart and SubagentStop only observe, as command hooks do.

`packages/experimental/hooks-claude-code/src/prompt.ts:promptRequestText`: the hook input JSON replaces every `$ARGUMENTS` token. A prompt with no token gets the JSON appended after a blank line. Where Claude Code places the input for a prompt without the token is from memory of its documentation, not checked against it.

`packages/experimental/hooks-claude-code/src/index.ts:runPoint`: prompt hooks use the command hook key, `hookKey(point, matcher, prompt)`, so `enabledHooks` and Settings address them the same way. A prompt hook that is not enabled is never evaluated, so it makes no model call. Prompt hooks run one at a time in config order, as command hooks do; Claude Code runs them in parallel.

`packages/experimental/hooks-claude-code/src/index.ts:commandGroups`: the inventory shows a prompt hook under its prompt text as its command, so the existing description and switch path handles it. Settings names the row with `hookName`, which takes the first word of the prompt, so the full prompt is only in the row title and details.

`packages/experimental/hooks-claude-code/src/index.ts:evaluatePrompt`: `llm` is not in `inject`, so the bridge loads and runs command hooks in a deployment without the model service. Prompt hooks read it with `ctx.get('llm')`, and a missing service throws inside the same try, so the hook fails open with a warning. The guard test `packages/experimental/hooks-claude-code/tests/bridge.spec.ts` pins the two-item `inject` list.

`packages/experimental/hooks-claude-code/src/config.ts:parseClaudeCodeConfig`: prompt hooks parse on every event except SessionStart, where they are skipped and reported. A prompt hook with no string `prompt` is dropped silently, as a command hook with no string `command` is. `agent` hooks stay skipped and are reported.

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection`: the skipped line now uses the `hooksNotSupported` label ("Not supported") in place of "Reported skipped hooks". It lists `agent` and SessionStart prompt entries, which have no switch.

`packages/host/plugin-inventory/src/hook-files.ts:handlerText`: for a claude-code file, a prompt hook is a handler on every event except SessionStart, matching the bridge. Codex files still skip prompt hooks.

## Delegation depth visibility

`packages/subagent/tool-subagent/src/depth-limit.ts:restrictAtDepthLimit`: an inherited delegation tool (the default composition, for example `subagent_fork`) is masked on each child created below its composition, on `agent/created`, when the child's depth plus one exceeds the cap that `ctx.subagents.resolveMaxDepth` returns. `tools.restrict` masks only inherited names, and it also covers the PTC SDK, which enumerates the same registry view. The decision is taken at creation and is not revisited when the Host depth setting changes; the provider's depth check at each start still rejects a call.

`packages/subagent/tool-subagent/src/index.ts:apply`: the standing composition with `modelSelectionSettings` installs the tool into each agent's own layer, where `tools.restrict` cannot mask it, because restrictions name inherited names only. `installScoped` therefore skips a child at the cap, which also drops its continuable prompt section and the model list.

`packages/subagent/tool-subagent/src/depth-limit.ts:cannotDelegate`: a `maxDepth: 'provider-managed'` tool has no cap here, so it never hides anything. Claude Code roles are uncapped in `execute` as well, but the hide happens before a route is chosen, so a depth-one child loses claude-cli reviewer routes along with in-process ones.

`packages/api/session-controller/src/run-options.ts:installRunOptions`: the subagent policy and the Ultracode instruction are added only for a top-level Session (`header.origin !== 'subagent'`). Children inherit the Subagent Setup through `effectiveSubagentSetupOf`, so without this gate every child would be told to run its own review through a subagent it cannot start.

## Hook runs and the sandbox policy

`packages/experimental/hook-protocol/src/runner.ts:runHook`: the request carries `sandboxPolicy` only when the bridge passes one, so a caller outside the bridges keeps the executor's deployment default. Before this change neither bridge passed a policy, so every sandboxed hook ran under the executor's deployment default whatever the session had approved.

`packages/experimental/hooks-codex/src/index.ts:runPoint` and `packages/experimental/hooks-claude-code/src/index.ts:runPoint`: each run resolves the policy with `SandboxPolicyService.resolve({ session })` when the agent is known, the same call the tool layer makes (`packages/fs/tool-fs/src/sandbox.ts`), and passes it to `runHook`. The service is read only when `ctx.shell.sandboxMode` is defined, so an executor without a sandbox never resolves it.

`packages/sandbox/sandbox-policy/src/index.ts:SandboxPolicyService.resolve`: the mode is the explicit request mode, else the session's last `sandbox/mode` override (`overrideOf`), else the deployment `defaultMode`. A call without a session takes the deployment mode, which is how the hook runs reached the confined path.

`packages/bundle/base/cordis.patch.yml`: the shipped deployment default is `workspace-write`, read from `DSH_PERMISSION_MODE` when set. A session that approved `danger-full-access` carries that as its `sandbox/mode` override, which its hooks did not see before this change.

`packages/shell/pwsh-sandbox/src/index.ts:SandboxPwshExecutor.resolve`: a request's own policy wins, and without one the executor stamps the deployment policy. Hook runs took that branch.

`packages/sandbox/sandbox-local/src/index.ts:windowsAclRunnerArgv`: a policy without a `sessionId` takes the agentless branch, with no per-session write SIDs. A session-bearing policy gets its workspace and temp write SIDs, so a hook that now carries the session gets the same grants as that session's own commands.

`packages/sandbox/sandbox-windows-acl/src/token.ts:createRestrictedToken`: a workspace-write run uses a WRITE_RESTRICTED token. A confined child can still read and write its workspace, but libuv's named-pipe stdio is opened with write access that no restricting SID is granted, so the open fails with ERROR_ACCESS_DENIED and Node reports `spawn EPERM`. The runner spec states this as the documented no-output-redirection boundary of WRITE_RESTRICTED tokens and pins piped capture as `pipe:DENIED` (`packages/sandbox/sandbox-windows-acl/tests/runner.spec.ts`).

`packages/sandbox/sandbox-windows-acl/src/token.ts:setTokenDefaultDaclGrant`: gives objects that take the token default DACL, such as anonymous stdio pipes and sync objects, a full-access ACE for the restricting SID it is passed: the temp write SID, else the workspace write SID, else the world SID (`packages/sandbox/sandbox-windows-acl/src/index.ts:AclSandbox.init`). It does not reach libuv's named-pipe stdio, which takes the Win32 default template instead (see the `createRestrictedToken` note above).

`packages/experimental/hook-protocol/src/codec.ts:parseHookOutput`: fail-open stays. Only exit 2 blocks, and a run that cannot start reaches this function with no exit code and its message on stderr (the `runHook` catch). That is the silent failure: the action proceeded and the failure was recorded only as `hook/result` stderr. Failing closed would turn every broken hook into a blocked tool call, a product decision, so it is not changed here.

`packages/shell/pwsh-sandbox/tests/hook-run.e2e.ts`: the reproduction. A hook `node parent.mjs <kind>` runs through `runHook` and `SandboxPwshExecutor`. Under the deployment default a piped child fails with EPERM while an inherited-stdio child succeeds; under `danger-full-access` piped children succeed, and aborting ends the grandchild tree.

`packages/experimental/hook-protocol/src/runner.ts:runHook`: trade-off. A `danger-full-access` session now runs its hooks unconfined, the authority its own shell commands already have (`SandboxPwshExecutor.execute` runs that mode unconfined), and hooks are user-configured commands. A `read-only` or `workspace-write` session now confines its hooks to that mode with the session cwd as the write root, so a read-only session's hook that writes a file fails, as a non-blocking failure, which is intended. Still open: under `workspace-write` a hook whose own children need piped stdio still fails with EPERM and fails open.
## Compaction ends with "This operation was aborted"

`packages/client/connection/src/http-bridge.ts:bridge`: `/api` RPC calls are one buffered HTTP POST held open until the Host method settles. The bridge aborts the handler's signal when the response closes before `end()`, so a dropped connection cancels the running command. The reason is now named ("client connection closed before the response completed") instead of the default DOMException, which surfaced as "This operation was aborted".

`packages/interaction/commands/src/index.ts:withAbort`: a command whose UI request signal aborts rejects with that reason; `settleThrown` writes it as the `command/done` error text. `packages/compaction/compaction-basic/src/index.ts:compactNow` rethrows the same reason from `operationSignal.throwIfAborted()`, so `compaction/end` carries it too.

Ruled out by controlled runs (`packages/llm/llm-pi-ai/tests/adapter.spec.ts`, pi-ai Anthropic route with scripted stalls):

- `packages/util/timeout/src/index.ts:idleWatchdog` with `packages/llm/llm-pi-ai/src/adapter.ts:PiAiAdapter` stream idle: a silent provider after headers or before headers yields `TIMEOUT` "pi-ai stream idle timeout after Nms", with or without a caller signal. It cannot produce the observed text.
- `packages/llm/llm-pi-ai/src/config.ts` profile `timeoutMs` (SDK request timeout): fires before headers only and yields "Request timed out." (`TIMEOUT`), not the observed text.
- Node `http.Server` `requestTimeout` (300000 by default): it kills a request whose body is still incomplete (ECONNRESET), but a fully read POST awaiting its response is not cut. `bridge` reads the body before dispatch, so this default does not close the command connection.
- Repository timers: no 300-second socket or request timer exists in repository code on the command path. The 300-second deadline is undici's default, which the forwarder below no longer uses. `packages/api/gateway/src/client/index.ts:invoke` has a 30-second unary deadline only for methods without a cancellation signal, and the observed failure is not that deadline's text.

Cause: the Electron main process forwards every `/api` request from the renderer with Node's global `fetch` (undici). `apps/desktop/src/web-document.ts:forwardWebRequest` previously relied on it, and undici's default headers deadline (300 000 ms) aborted the connection while the Host held the command's buffered response open. Measured with the real transport: global `fetch` rejected with `UND_ERR_HEADERS_TIMEOUT` at 306.5 s against a 330 s Host, and through the old `forwardWebRequest` at 314.8 s; `node:http` returned 200 at 330 s. The bridge then saw the response close and aborted the command.

Fix: `apps/desktop/src/web-document.ts:requestHost` issues the Host request with `node:http`, which has no default headers or body deadline, so no client timeout cuts a long command. Undici is not a dependency of `apps/desktop`, so an undici `Agent` with zero timeouts was not available without adding one. `node:http` also keeps the renderer's cancellation: aborting `request.signal` destroys the outgoing request, before or after headers. The forwarder removes `accept-encoding` from forwarded requests so the Host answers identity-coded bytes, which are relayed unchanged; `apps/desktop/src/web-document.ts:forwardWebRequest` no longer withholds `content-encoding` or `content-length` for that reason.

Other main-process calls to the Host are short and keep their own deadlines: `apps/desktop/src/web-document.ts:authenticateWebHost` (a 303 exchange) and `apps/desktop/src/main.ts` welcome backend (`net.fetch`, analytics with a 1 s deadline). `packages/util/http-proxy/src/install.ts:createPolicyDispatcher` installs an undici global dispatcher with the same default deadlines; the desktop main process does not call it, and it applies to Node-side `fetch` callers, not to the renderer's Host route.
## Team task tools

`packages/team/tool-agent-team/src/index.ts:apply`: the Team task-board plugin injects `subagents` and is loaded after `SubagentRuntime` in `scripts/tool-catalog-manifest.ts`, which provides the delegation and messaging service during catalog generation.

## Desktop computer use

`packages/boot/app-boot/src/profile.ts:OPTIONAL_BUNDLES`: the native Cua Driver provider is listed beside the other optional bundles, so the Desktop and Web Plugins page offers it switched off. This admits a native closure into every dsh installation, reversing the computer-use exclusion in the 2026-09-21 optional-bundle record for the native provider only; the MCP provider stays an explicit composition, because it needs a separately installed executable.

`packages/experimental/computer-use-cua-driver-native/cordis.patch.yml`: the bundle inserts the shared `computer-use` service and the provider row. The provider's peer dependency on that service must resolve from the installation, so `apps/cli/package.json` lists both packages as runtime dependencies. The Desktop closure is rooted at dsh and the private Host, so the same runtime dependency puts the provider and its platform binary in the Desktop runtime.

`apps/desktop/scripts/electron-builder-config.mjs:createElectronBuilderConfig` (its `**/*.{node,dylib,dll,so,exe}` unpack pattern) already keeps the win32 Cua Driver files outside the asar: `cua_driver_node_runtime.node` and `cua_driver_sdk.dll` in `@trycua/cua-driver-win32-x64-msvc`. The native provider is loaded in-process by `packages/experimental/computer-use-cua-driver-native/src/index.ts:apply`, so these files must be real files, not asar entries.

`scripts/optional-bundles.spec.ts:bundle`: the computer-use test pins the two inserted row ids and names, so a patch that drops either row or a service mount fails before the Plugins page is reached.

## Subagent MCP scoping

`packages/subagent/tool-subagent/src/mcp-scope.ts:scopedToolFilter`: a fresh child no longer inherits every MCP tool. The `subagent` tool takes an optional `mcp` list of server names; every global `mcp__<server>__*` tool from any other server is added to the request's `toolFilter.deny`, merged with the deployment's configured filter. Omitting `mcp` denies all MCP tools. Measured on a real install, ~209 tools made a child's first request 44–66K tokens, most of it MCP schemas resent on every step.

`packages/subagent/tool-subagent/src/mcp-scope.ts:scopesMcp`: scoping applies only when the provider has the `toolFilter` capability and does not inherit the parent context. A forked child (`subagent_fork`) keeps the parent's tool list, because changing tools would invalidate the cached prefix it reuses. The claude-cli route (`packages/subagent/tool-subagent/src/index.ts`, `claudeCli`) is skipped too; it runs its own tool set.

Known ceiling: the deny list is computed once when the child starts. A server that connects later is not denied, and continuing a child after a denied server is removed fails in `tools.restrict` with an unknown-tool error (`packages/subagent/subagent/src/child-agent.ts`, `composition.toolFilter`).
## Subagent step budget

`packages/subagent/subagent/src/step-budget.ts:installStepBudget`: when a delegated child (`delegationDepthOf(agent) > 0`) reaches step `stepBudget` of one turn (default 40, set on `SubagentRuntime.Config`; 0 turns it off), a notice user message is appended to that step. It reuses the `repeat-tool-reminder` source kind with `form: 'notice'`, because Session format 4 is finalized and a new kind would need format 5 (`scripts/persistence-changes.ts`). It tells the child to wrap up and report what is finished and what is left. Every step resends the child's whole history, so long runs get expensive: on a real install, DeepSeek children averaged 63 requests and 159K context, and 119 went past 60 requests. This is only a nudge, and later steps are not rejected. It fires once per turn, so a continued child gets a fresh budget on each `send_message`. The claude-cli route has its own hard cap, `maxTurns` (`packages/subagent/subagent-claude-code/src/index.ts:Config`).

`packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx:CatalogRows` shows each subagent's current context size (`catalog-format.ts:contextTokens`, the figure the chat context meter uses) and puts the summed usage of all its requests in the hover title. The sum adds cache reads for every step, so a reviewer at 40K context passed 500K within a minute and read as runaway usage. Rows without a context sample fall back to the sum. The second line names the model the child last ran (`modelSelection.lastUsed`), else the one queued for its next request, since a router or fallback can run something other than the selection.

`patches/@ubjs__node@0.31.0-3.patch:resolveNpmPackage` (registered in `pnpm-workspace.yaml:patchedDependencies`): `@trycua/cua-driver` finds `cua_driver_sdk.dll` through `@ubjs/node`'s `resolveLibPath`, which resolves the platform package with `require.resolve`. In the packaged Desktop app that path is inside `app.asar`. Electron's patched `fs` makes `existsSync` succeed there, but `LoadLibrary` is not asar-aware, so enabling Computer Use failed with `library open failed ... (os error 126)` even though the DLL sits unpacked in `app.asar.unpacked` (see the `electron-builder-config.mjs:createElectronBuilderConfig` unpack pattern above). The patch returns the `app.asar.unpacked` twin of the path when that file exists, and leaves every other path unchanged. Electron redirects only `require()` of `.node` files, which is why `cua_driver_node_runtime.node` loaded and the DLL did not.

## Subagent live activity

`packages/subagent/subagent/src/activity-projection.ts:subagentActivityProjectionDefinition` folds `step/start`, `tool/call` and `tool/result` into `{ steps, running?, last? }` so a parent's catalog row can show what a child is doing without opening it. `running` is the newest call still awaiting its result (up to eight are kept, matched by `callId`); `last` is the newest finished call with `isError` and a one-line, 120-character result summary. `turn/start` resets the state and `turn/end` drops running calls, so a closed child never shows a stale tool. It is a new projection key with its own `stateVersion`, so existing checkpoints and sessions load unchanged and the key simply starts folding from the log. `packages/subagent/subagent/src/activity-projection.ts:describeToolCall` returns the shared `packages/util/values/src/index.ts:liveToolDetail`, the client-safe function it imports from `@deepseek-ai/dsh-util-values`, so a call whose arguments name nothing usable (or do not parse, as with partial streamed JSON) shows its tool name. `packages/client/ui-subagent/src/client/catalog-format.ts:toolTarget` prints that name alone when the detail equals it.

`packages/client/ui-subagent/src/client/catalog-format.ts:liveActivityLine` renders it as a third line on `SubagentHeaderLineage.tsx:CatalogRows` (`Now: bash: git diff … · step 7` while running, `Last: read: a.cs → result` once idle).

`packages/client/ui-chat/src/client/chat/RunningStatus.tsx:RunningStatus` now leads with the concrete operation from `live-activity.ts:liveActivity` (tool, key argument, time on that operation) followed by the step and total turn time. A generic "Working" line, with step and total turn time, appears only when no operation is known, such as before the first model output. `RunningActivity.tsx:activityText` is the shared formatter and `RunningActivity` now carries only the quiet-turn Stop hint.

`packages/client/ui-chat/src/client/chat/ChatGroupSeat.tsx:ChatGroupSeat` opens a live process group by itself when the work-details mode shows live detail (`presentation-policy.ts:liveProcessDetail`, so standard and detailed, not compact) and scrolls it to the newest member. A click closes it for the rest of that group's run (`dismissed`). `packages/client/ui-tool/src/client/tool/toolviews/bash-sample.tsx:StartedBashRow` does the same for a running command, so its command line and streaming output show without a click.

## Desktop runtime install applies the @ubjs/node patch

`apps/desktop/scripts/prepare-dsh.ts:stageRuntimePatches` copies `patches/@ubjs__node@0.31.0-3.patch` into the disposable runtime project and appends `patchedDependencies` to its `pnpm-workspace.yaml`. The packaged runtime is installed by a separate pnpm project from the packed package set, so the repository's `patchedDependencies` never reached it: build 20261017.3 still resolved `cua_driver_sdk.dll` inside `app.asar` and Computer Use kept failing with os error 126. Verified by running the packaged `DeepSeek Harness.exe` with `ELECTRON_RUN_AS_NODE` and calling `resolveLibPath`.

## packages/client/ui-master-control/src/client/index.ts:apply

Master Control is a global sidebar panel (`PANEL_ID = 'master-control'`) plus a `main` page, registered the same way as `ui-plugin-manager/src/client/index.ts:apply`. Plugins registers at `order: 0` and ties keep registration order, so the entry uses `order: -10` to sit above Plugins regardless of load order. `interrupt` goes through `sessions.using(..., { source: 'masterControl' })` and `session.cancel()`, the same path the workspace operations use; the source label is merged into `SessionReferenceSourceMap` in this file. The page reads sessions through the root hooks `useSessions` and `useSessionStatus`, so no plugin-owned store is needed. `openMasterChat` reuses a session whose projected `agentPreset` is `master`, else `sessions.create({ agentPreset: 'master', workspaceId })` then `uiWorkspace.openSession`.

## packages/client/ui-master-control/src/client/index.ts:openMasterChat

Creates the human chat surface for assigning work and asking status. The roster stays the monitor; conversation lives in a normal session with the `master` preset.

## packages/client/ui-master-control/src/client/rows.ts:masterRows

Rows sort attention, failed, running, idle, each most recent first. State precedence is pending interaction, then unread failure, then running (UI status map first, summary `running` as fallback). Blank New Session placeholders are dropped. Delegated children are listed flat with `child: true`; nesting is left for the master-agent step.

## packages/subagent/tool-master-control/src/index.ts:apply

- `mc_list_sessions`, `mc_send`, `mc_interrupt` mesh tools reach any enrolled loaded peer (not adjacent-child-only like `send_message` / `interrupt_agent`).
- Any calling agent may use the tools; self-target is rejected. Enrollment: `Config.managed` or `Config.managedAll`.
- `mc_send` steers with an `agent-message` relay (`Agent <id> sent a message:`). Optional `wait` awaits `whenIdle` (120s cap) and folds the reply only from the turn that claimed the relay, so a failed or cancelled turn yields a `note` instead of an older answer.
- Relay loops are bounded without shared state: `relayOutcome` reads the target's own log for the claimed relay, `waitCycle` follows each session's unsettled `mc_send` call to refuse a wait that would deadlock, and `recentRelays` caps settled relays to one peer inside `MC_RELAY_WINDOW_MS`.
- `mc_list_sessions` includes truncated `last_reply` so the master can answer how peers are doing.
- `mc_interrupt` cancels with `{kind:'parent'}`. Targets must be loaded in `ctx.agents`.

## packages/api/session-controller/src/client/sessions/manager.ts:create

Forwards optional `agentPreset` on the Host create RPC so the UI can open a master-preset session without a separate composition write.

## packages/bundle/web-app/presets/master.patch.yml

- Master mounts `orchestration-policy` plus `tool-master-control` (`managedAll: true`). Only the master preset mounts the mesh tools; `standard` and `lean` omit them, so an ordinary or imported chat cannot message, interrupt, or read other sessions.
- Master is a trimmed lean-like preset plus delegation; presets have no `extends`.

# Master Control home and external text imports

`packages/api/session-controller/src/master-control.ts:MasterControlSessions` owns serialized host home resolution and import creation. Reserved session identities distinguish the supervising home and imported chats without changing released session header types. Imported history uses ordinary balanced DSH events, reserves an empty protected system head before imported text, and is flushed before success; no imported tools or vendor system instructions execute.

`packages/api/session-controller/src/external-chats.ts:ExternalChats` discovers bounded recent source logs and admits only discovered keys. Text-only previews and imports exclude tool payloads, attachments, reasoning, and vendor configuration. Unsupported or oversized rows report a visible error.

`packages/client/ui-master-control/src/client/rows.ts:groupMasterRows` groups by existing workspace membership and filters before rendering. Home identities are omitted from the worker roster.

`packages/client/ui-master-control/src/client/MasterControlPage.tsx:MasterControlPage` refreshes discovery activity and the roster clock on open and once a minute, but never imports: only `ImportChats` submits the selected keys, so a page visit cannot create sessions.

`packages/api/session-controller/src/list.ts:ApiSessionList` initializes reserved master homes as nonblank, so workspace navigation cannot reuse the supervising session as a provisional New Session. Projection state version 2 invalidates older derived metadata while ordinary empty sessions remain blank.

`packages/api/session-controller/src/commands.ts:SessionCommandController.create` refuses explicit reserved home identities on the ordinary create path. Only the internal `createMasterHome` operation admits those identities, preventing an ordinary caller-created master session from becoming the supervising home.

## Pinned chats lead the Chat Sections pane

`packages/client/ui-workspace/src/client/sections.ts:deriveSections` now takes the registry-global pin and archive sets (the `rowState` that `rows/SectionsList.tsx:SectionsList` already holds) and fronts pinned, unarchived Sessions inside each section and in the ungrouped remainder, keeping each partition's order. Before, only `tree.ts:sectionMembers` (Workspace tree) and `tree.ts:deriveFlat` fronted pins, so with Chat Sections in use the pin marker showed but pinned chats stayed in recency order. Archived Sessions are never fronted, matching the host rule that archive wins over pin.

`apps/web/tests/session-pin.e2e.ts` covers the Workspace tree end to end (pin from the row menu, host registry, reload, unpin). Unpin keeps the Session's slot in Manual order by design (`tree.ts:reconcileManualOrder`).

## Default-product experimental isolation

`packages/host/plugin-inventory/src/types.ts:HookInventoryReport` owns the hook report shape and the `hooks/inventory` event augmentation. The release package names no experimental package, because `verify-default-product-isolation` rejects experimental peers even when optional and `packages/experimental/AGENTS.md` forbids them in every runtime dependency section. `packages/experimental/hook-protocol/src/inventory.ts:hookEnabled` is the experimental side: it imports `hookKey` from `packages/host/plugin-inventory/src/hook-key.ts:hookKey` and the report types from the release package. External hook files stay listed by default through `packages/host/plugin-inventory/src/hook-files.ts:readHookFiles`, which reads without executing; hook execution stays in the experimental bridges, which are not mounted by default.

`packages/bundle/web-app/presets/economy.patch.yml` no longer declares the disabled `tool-ralph` row. The `packages/experimental/ralph-bundle/cordis.patch.yml` optional bundle inserts its own `optional-ralph` group, so the default economy composition does not name `@deepseek-ai/dsh-tool-ralph`.

`scripts/product-package-policy.ts:PRODUCT_PACKAGE_POLICY` drops the stale optional declaration for `packages/core/agent-tool-presentation`, which the economy preset mounts by default, and declares `packages/knowledge/knowledge-source-git` as an optional maintained role: a resolver that no product composition mounts.

`scripts/package-dependency-policy.ts:PEER_REQUIRED_HOST_EXPORTS` no longer lists `OperatorPeer` for `@deepseek-ai/dsh-client-connection`, because the merged tree does not export that symbol.

`python/sdk-runtime/package.json` depends on `@deepseek-ai/dsh-tool-master-control`, which the shipped master preset (`packages/bundle/web-app/presets/master.patch.yml`) mounts, so the runtime closure includes it.

`packages/client/ui-settings-account/package.json` removes `./assets/*` and `lib/assets`: the package references no image, and `packages/client/modules/src/assets.ts:PACKAGE_ASSET_EXPORT` applies only to packages that do.

`packages/client/ui-master-control/package.json`, `packages/client/ui-memory-workspace/package.json`, and `packages/client/ui-provider-quota/package.json` drop their React type devDependencies; only the root manifest declares them (`packages/client/AGENTS.md`, dependency declaration rule 8).


## packages/fs/tool-str-replace-editor/src/index.ts:fileEol

`str_replace` matched `old_str` with an exact `indexOf`, and models always send `\n`, so any multi-line `old_str` failed on a CRLF file ("did not appear verbatim"). Agents then wrote throwaway Python scripts to patch CRLF files. `fileEol` picks CRLF only when CRLF lines outnumber bare LF lines; `withEol` converts `old_str`, `new_str` and inserted text to that ending, so edits match and never introduce bare LF. LF and mixed-majority-LF files keep the old exact matching.

## packages/client/ui-plugin-manager/src/client/McpServersSection.tsx:McpServersSection

`McpServersSection` renders MCP sign-in notices in a wrapping `.notice` span instead of the one-line ellipsised `.detail`, because the trailing "Open sign-in page" link was being truncated away.

`packages/team/agent-team/src/projection.ts:applyProjectionEvent` retains version 1 and 2 Team roster and mailbox records as read-only history; `packages/client/ui-agent-team/src/client/TeamBoard.tsx:TeamBoard` displays them without reconnecting members. Checkpoint version 8 rebuilds from the preserved Session log.

## apps/desktop/tests/welcome-flow.e2e.ts:desktopTarget

The synthetic project uses a macOS target without requiring a prepared Desktop target; the suite does not compare platform or architecture outside packaging.

## scripts/verify-upgrade-guides.ts:GUIDE

Upgrade guides require the Change and Migration sections and are limited to 500 words.

## Catalog field contracts

### `packages/mcp/mcp-client/src/index.ts:StdioConfig`
- `includeServerInstructions`: Publish nonblank server instructions in the system prompt (default true).
- `toolFilter`: Filter exposed tools and human operations by raw server tool name.

### `packages/mcp/mcp-client/src/index.ts:StreamableHttpConfig`
- `headerEnv`: Map HTTP header names to environment-variable names; literal headers take precedence.
- `includeServerInstructions`: Publish nonblank server instructions in the system prompt (default true).
- `toolFilter`: Filter exposed tools and human operations by raw server tool name.

### `packages/mcp/mcp-client/src/tool-filter.ts:ToolFilterConfig`
- `allow`: Raw names to allow; an empty list allows all names.
- `deny`: Raw names to deny after applying the allow list.

### `packages/subagent/tool-subagent/src/index.ts:Config`
- `claudeCliProvider`: Provider name used for Claude CLI role routes (default `claude-code`).

### `packages/context/tmux-context/src/index.ts:Config`
- `queryTimeoutMs`: Milliseconds the whole tmux location query may take before it is abandoned as unknown. Defaults to 5000.

### `packages/experimental/browser-use-stagehand-native/src/index.ts:Config`
- `operationTimeoutMs`: Milliseconds for Chromium startup and for Stagehand navigation and model-assisted actions; the Worker connection, its initialization, tab operations and screenshots are also abandoned and the connection closed once the request has run this long plus 15 seconds. Defaults to 30000.

## Catalog event and service contracts

### `packages/mcp/mcp-client/src/status.ts:mcp-client/inventory`
- `description`: Collect connection reports from globally scoped MCP instances.
- `mode`: emit
- `params.reports`: Mutable collection to which each instance adds its report.

### `packages/mcp/mcp-client/src/status.ts:mcp-client/reconnect`
- `description`: Request an immediate connection attempt for a named MCP server.
- `mode`: emit
- `params.serverName`: Local namespace of the server to reconnect.

### `packages/mcp/mcp-client/src/human-operations.ts:mcp/human-operations`
- `description`: Resolve the human operations exposed by a named MCP server.
- `mode`: waterfall
- `params.server`: Local namespace of the requested server.

### `packages/api/session-controller/src/index.ts:SessionController.teamRoleDefaultOf`
- `description`: Resolve a Team role route from the first saved setup in the Session ancestry, or the global default when no ancestor has one.
- `params.session`: Session whose ancestry supplies the role settings.
- `params.role`: Team role to resolve.
- `returns`: The saved route, or undefined when no enabled route exists.

### `packages/api/session-controller/src/index.ts:SessionController.missingCredentialProvider`
- `description`: Report whether a provider’s named API-key credential is unconfigured.
- `params.provider`: Provider identifier to check.
- `returns`: Whether the named credential is unconfigured; false when no named reference exists.

## scripts/gen-config-catalog.ts:pasteText

The configuration catalog fills missing field descriptions from anchored code notes and still reports missing descriptions as violations.

## Account notification contracts

### `packages/credentials/deepseek-account/src/index.ts:DeepSeekAccount.getNotifications`
- `description`: Queries unconsumed notifications in server order without reading profile data.
- `params.client`: Identity of the requesting UI; its language selects the server-authored message.
- `returns`: Notifications with their next query delay, or null when the account grant is absent or changed.

### `packages/credentials/deepseek-account/src/index.ts:DeepSeekAccount.getNotificationContent`
- `description`: Queries localized content for a notification, including one already consumed.
- `params.id`: Notification whose content is requested.
- `params.client`: Identity of the requesting UI; its language selects the localized content.
- `returns`: Content without changing consumption, or null when the account grant is absent or changed.

### `packages/credentials/deepseek-account/src/index.ts:DeepSeekAccount.reportNotificationEvent`
- `description`: Reports a notification interaction; Platform decides whether the notification is consumed.
- `params.id`: Notification the user interacted with.
- `params.event`: Displayed frame, non-dismiss action click, or explicit dismissal.
- `params.client`: Identity of the requesting UI for this call.
- `returns`: True when Platform accepts the event; false when the account grant is absent or changed.

## packages/typert/generator/src/cordis-catalog.ts:CordisCatalogPolicy

The runtime type declaration override resolves distinct Office rendering generation brands in the shared catalog while identical declarations are deduplicated.

`apps/web/tests/scaffold.ts`: Type-only imports provide the Host Context service types used by the test scaffold.

`scripts/plugin-preview-assets.spec.ts`: English plugin previews must remain self-contained 640 by 300 SVGs within the per-file size limit.

`packages/shell/tool-pwsh-persistent/src/index.ts:wrapCommand` encodes command text as UTF-8 Base64 before embedding it in the persistent PowerShell input line. This preserves line endings and Unicode while preventing command text from changing the wrapper's quoting; execution still uses the existing shell and status markers.

## Model menu focus

`packages/client/ui-model-selection/src/client/ModelSelect.tsx:ModelSelect` remembers the detail pane key and finds its matching root-menu button after returning, since the original button is unmounted while the pane is open.

## MCP credential rejection

`packages/mcp/mcp-client/src/connection.ts:startConnection` reports a rejected static credential immediately, closes the affected generation, and follows the configured reconnect policy only after cleanup. OAuth rejections instead wait for a new grant. Stale generations cannot change the current status.

`packages/mcp/mcp-client/src/types.ts:McpConnectionStatus` uses `authentication-rejected` while a rejected static credential's generation is closing. `reconnect-disabled` and `gave-up` mean automatic attempts have stopped; `unclosed-generation` prevents replacement after incomplete cleanup.

`packages/mcp/mcp-client/src/oauth.ts:grantAuthProvider` preserves token-refresh transport and server failures when the SDK falls back to interactive authorization. OAuth discovery, issuer and resource validation remain in the SDK, and invalid grants still require sign-in. The refresh observer recognizes the URLSearchParams request format used by SDK 2.2.0; revisit it when upgrading that SDK.

`packages/mcp/mcp-client/src/index.ts:apply` exposes an OAuth sign-in request as an actionable state without an error message. `packages/mcp/mcp-client/src/connection.ts:startConnection` clears that pending state when a template credential becomes missing, so its diagnostic remains visible.
# Persistent PowerShell prompt attribution

`packages/shell/tool-pwsh-persistent/src/index.ts:executeCommand`, `packages/terminal/terminal/src/types.ts:TerminalSendRequest`, `packages/terminal/terminal-bash/src/session.ts:LocalPtySession`, and `packages/terminal/terminal-bash/src/sanitize.ts:TerminalSanitizer.resetPromptTracking`: The first wrapped send asks a supporting backend to hold readiness until the command's emitted start marker appears on its own line. The marker clears prompt and stdin-wait evidence from before command start; a foreground inspection spanning the marker is discarded and sampled again. The tool's outer line watch remains the fallback for backends without the gate.

### `packages/terminal/terminal/src/index.ts:TerminalSessionService.watchLine`
- `description`: Watches an owned terminal for a complete output line when its backend supports it.
- `params.owner`: Agent that owns the terminal.
- `params.id`: Owned terminal identity.
- `params.line`: Complete output line to observe.
- `returns`: A watch handle, or undefined when the backend does not support watching.

packages/client/ui-workspace/package.json:dsh.client.inject includes the command UI provider required by packages/client/ui-workspace/src/client/index.ts:inject, so roster closure can activate the workspace.

### `packages/terminal/terminal-bash/src/sanitize.ts:TerminalSanitizer.resetPromptTracking`
- `description`: Discards a prompt-tail candidate observed before the active send's readiness boundary.

## packages/client/ui-settings-models/src/client/ModelsSection.tsx:Loaded

`packages/client/ui-settings-models/src/client/ModelsSection.tsx:Loaded` renders one sign-in card in each `llm-pi-ai` row when the page has authorization operations, and hides the editor's own card (`ProviderEditor.tsx:ProviderEditor` prop `hideSignIn`) for exactly those rows through the shared `rowSignIn` value. A row of another namespace has no row card, so its editor keeps its own. `SignInCard.tsx:SignInCard` offers "Use an API key instead" only when `onUseApiKey` is passed; the row card passes `toggleEditor(target, open, true)`, which opens that row's editor (clearing the saved notice and closing the add card as the Edit button does) and records `keyFocusFor` and `keyFocusAsk`. The editor receives `focusKeyRequest` only for the asking row, and `ProviderEditor.tsx:ProviderEditor` focuses its key field in an effect keyed on that value, so the request works both when the editor mounts and when it is already open. `keyFocusAsk` increments on every toggle so a second ask repeats the focus; `keyFocusFor` is cleared by an Edit toggle and by `closeAdd`, so a later open without the card never focuses the field. `toggleEditor` closes the add card first because closing either card would discard the other's draft.

## Review fixes 2026-11-23

`packages/fs/fs-local/src/fsio.ts:assertVersion`: guarded writes, edits, patches, deletes and move-source removals re-probe the target right before the mutation and reject `FS_STALE_VERSION` when the version drifted since it was observed. `writeFileAtomic` runs it after staging and before publication; `removeFile` runs it before `rm`; `packages/fs/fs-local/src/index.ts:LocalFileSystem.moveFile` runs it on the source before the destination is published and again before the source is removed (a late change keeps the source and reports `sourceDeleted: false` with `FS_STALE_VERSION`). This narrows the window from the whole read-compute-stage cycle to the gap between the probe and the rename or unlink. It is not closed: POSIX `rename` and `unlink` cannot be made conditional on a version, so an uncooperative external writer that lands inside that gap still loses to the harness. `packages/fs/fs-local/README.md` states this limitation instead of promising a strong stale-write guarantee. Unconditional `editText` and `patchText` use the version observed under the lock as their baseline; unconditional `writeText` stays a deliberate blind overwrite.

`packages/storage/storage-json/src/single-unit.ts:openSingleUnit`: a `single`-layout unit republishes its whole document from an in-memory copy, so two hosts sharing one root silently erase each other's changes. Opening such a unit now holds `<root>/<unit>.json.lock` (the `@deepseek-ai/dsh-atomic-write` `withFileLock` PID lock with `waitMs: 0`) until `close()`. A second host that opens the same unit while the first is alive fails with `StorageError('locked')` naming the lock path instead of racing; a lock whose holder process exited is taken over by the existing dead-PID rule. This is the smallest step for the shipped workspace domain (the only `single` unit in the base profile); it does not coordinate hosts on different machines or PID namespaces, does not refresh a running host's copy, and does not cover `per-record` units (each record is published independently, so a second host replaces whole records, not the unit). A `StorageError('locked')` is a new code in `packages/storage/storage/src/error.ts:StorageErrorCode`. Remaining follow-up: a read-modify-write protocol with refresh and cross-host notification if two hosts must share a home.

`packages/util/atomic-write/src/index.ts:takeOverExitedLock`: the takeover claim file records its claimant PID, and `breakAbandonedClaim` removes a claim whose claimant exited, so a crash between creating the claim and removing the dead lock no longer blocks every later contender until its timeout. The same rule (`isAbandoned`) covers an incomplete record: a lock or claim created by exclusive create whose process died before writing its PID stays unreadable as a PID forever, so a record that is not a complete `<pid>\n` and whose mtime is older than `INCOMPLETE_RECORD_GRACE_MS` (30 s, far above the microseconds a live writer needs between create and write) is treated as abandoned and goes through the same claim-protected takeover. A claim is broken by renaming it to a unique tombstone and comparing the tombstone's content with the stale record; if the content differs the rename grabbed a live contender's fresh claim, which is linked back. Remaining limits: that restore has a window in which a third contender could create a claim, and the grace period assumes a live writer is never suspended for 30 s between create and write; either failure can let two takeovers overlap, but the lock itself is still created with an exclusive create, so two live holders cannot be created by it. A lock whose PID a live process reused still needs an operator to remove `<file>.lock`; the manual recovery is to confirm no writer runs, then delete `<file>.lock` and any `<file>.lock.takeover-*` files.

`packages/storage/storage-json/src/atomic.ts:writeAtomic`: once `rename` has replaced the target the new document is visible, so a failing parent-directory sync can no longer mean "rolled back". `writeAtomic` now throws `StorageError('unknown-state')` for a failure after publication (the visible content is the new one; only its crash durability is uncertain), while any earlier failure still removes the temp file and rethrows unchanged. `packages/storage/storage-json/src/single-unit.ts:SingleJsonUnit.poison` keeps the in-memory state at the published content instead of rolling back, marks the unit unusable so later calls reject with the same error, and the existing `packages/storage/storage-domain/src/domain.ts:enqueue` path quarantines the domain on that code, so a later write cannot republish a stale snapshot over the new file. `packages/storage/storage-json/src/per-record-unit.ts:PerRecordJsonUnit.writeDocument` does the same for a record or global write. Reopening the domain re-reads whatever the file system holds. `packages/storage/storage-json/src/dirsync.ts:fsyncDirectory` moved out of `atomic.ts` so tests can inject the sync failure on every platform, including Windows where the real sync is skipped.

`packages/credentials/credentials-local/src/index.ts:assertOwnerOnly`: the provider creates the document through `packages/util/atomic-write/src/index.ts:writeFileAtomic` with mode `0600`, which Windows maps to nothing: the staged file inherits the DACL of its directory, and the rename keeps that DACL. No Node API reads or sets a DACL, so owner-only access on Windows cannot be enforced or verified without a native binding (`koffi`, as `packages/fs/fs-local/src/win32.ts` uses for guarded replacement). The README no longer claims owner-only creation on Windows and tells the operator to place the file in a directory only the owning account can read. Remaining work: create the staging file with a protected owner-only DACL through `SetFileSecurityW`, read the existing DACL on boot, and refuse a broader one.

`packages/core/agent-loop/src/index.ts:AgentLoop`: a root context disposes its plugins concurrently, so the JSONL persistence provider removed its `session/event` listeners and closed every write handle about 1 ms after teardown began, while an active turn still needed up to the abort latency to append `turn/end`; that event was then dropped. Cordis unloads a provider's effects only after every dependent fiber has unloaded, but this factory reads `sessionPersistence` through `ctx.get` and so was not a dependent, and in loop-first mount order it loads before the provider exists. `AgentLoop[Service.init]` therefore mounts `ctx.inject(['sessionPersistence'], ...)`, a fiber that appears in either order and whose disposer awaits `FactoryOwnership.dispose()` only when the factory itself is unloading; removing the provider alone leaves agents running as before. Covered by `packages/core/agent-loop/tests/shutdown-drain.spec.ts` (hang-slow variant fails without the dependent fiber).

`packages/experimental/liveshare/src/host/shared-tools.ts:SHARED_TOOL_PROFILES`: `run_code` is no longer on the shared surface. Its program runs under the owner's standing file policy, which neither the workspace grant nor the view tier narrows, so admitting the transport let a viewer read or write outside the grant and write on a view-only share even though each nested tool call was guarded. The surface now omits it, `fork-enforcement.ts:installForkEnforcement` and `installSourceSessionAccess` refuse the name through the unlisted-tool path, and `fork-policy.ts:READ_ONLY_FORK_CEILING` lists it under `deniedCapabilities`. The client warning `dialog.ptcSandboxWarning` in `src/client/SharePermissionFields.tsx` is now stale and is left for a follow-up. Covered by `tests/fork-enforcement-unit.spec.ts`, `tests/shared-tools.spec.ts` and `tests/readonly-fork-policy.spec.ts`.

`packages/experimental/liveshare/src/host/shared-tools.ts:SHARED_TOOL_PROFILES`: `web_fetch` is no longer on the shared surface. The shipped HTTP provider accepts loopback, private-network and cloud-metadata destinations and the guard passed it through as a tool with no file effect, so a viewer turn could aim requests at services reachable only from the owner's machine. A viewer-specific destination policy (resolved-address and redirect validation) is a larger design than the finding needs, so fetch is refused for viewer turns and `web_search` remains. Covered by `tests/fork-enforcement-unit.spec.ts` (guard refusal), `tests/shared-tools.spec.ts` and `tests/readonly-fork-policy.spec.ts`.

`packages/skill/skill-gsd/assets/briefs/executor.md`: coders of one wave share a git index, and git locks it per command, so `git add` followed by a bare `git commit` could commit another coder's or the user's staged files. The brief and `assets/shared/conventions.md` now require `git commit -m ... -- <paths>`, which commits only the named paths and leaves other staged entries in place, plus a check of `git show --name-only HEAD` that stops with BLOCKED on a stray path. The workflow still has no isolated checkout per coder (the skill tests forbid that word and plans share one tree), so two plans that touch the same path or a coder that edits outside its plan are not isolated. Covered by `packages/skill/skill-gsd/tests/skill-gsd.spec.ts` (the interleaved-staging test runs real git).

`packages/feedback/command-feedback/src/index.ts:executeFeedbackCommand`: with the shipped feedback-gated telemetry, `/feedback` releases the session prefix to the collector but its description and acknowledgement said only that a remark was recorded. The command description now states the conditional release before the command runs, and the acknowledgement adds a line when `ctx.get('sessionTelemetry')` shows a backend is mounted (DISABLED mode mounts none). This is a narrowing: the finding's withdrawal path (`packages/client/ui-message-feedback/src/client/MessageFeedbackActions.tsx`), a dialog-level disclosure, a feedback-without-sharing option and default redaction rules need UI, copy in every locale and a new telemetry option, and are deferred. Covered by `packages/feedback/command-feedback/tests/command-feedback.spec.ts`.

## packages/credentials/deepseek-account/src/index.ts:Events['deepseek-account/revocation']
The event JSDoc carries description, `@mode emit` and `@param outcome` because the cordis catalog generator rejects events without them; listeners are not awaited.


### `packages/api/workspace-files/src/index.ts:Config`
- `confineReads`: Refuse reads, stats and file change targets that resolve outside the Session workspace for a non-owner principal; default true. The owner and trusted in-process callers are never confined.
- `readRoots`: Extra absolute directories a confined non-owner principal may read besides the Session workspace root.

### `packages/client/ui-memory-workspace/src/index.ts:Config`
- `graphTimeoutMs`: Time in milliseconds a Graphify run may take before it is stopped; default 120000.
- `maxGraphDocuments`: Most imported documents the adapter accepts from one Graphify store; default 500.
- `maxGraphSourceBytes`: Most source text bytes the adapter accepts from one Graphify store; default 64 MiB.

### `packages/experimental/hooks-claude-code/src/index.ts:Config`
- `mandatory`: Treat the hook configuration as required: a missing, invalid or partly unsupported configuration refuses plugin activation instead of logging a warning and registering no hooks.

### `packages/experimental/hooks-codex/src/index.ts:Config`
- `mandatory`: Treat the hook configuration as required: it refuses plugin activation on a missing, unreadable, invalid or skipped-handler configuration, and a PreToolUse `updatedInput` denies the call instead of being ignored.

### `packages/experimental/webhook-github/src/index.ts:Config`
- `maxConcurrentRequests`: Requests allowed to read and verify a body at once; further requests get 429. Default 16.
- `bodyTimeoutMs`: Milliseconds allowed to receive one request body before it is dropped. Default 30000.
- `replayWindowMs`: Milliseconds a verified body is remembered so an identical replay is acknowledged but not dispatched again; 0 disables. Default 3600000.

### `packages/experimental/webhook/src/types.ts:WebhookRuntimeConfig`
- `journalFile`: Absolute path of the delivery journal, or false to disable it; omitted uses the Host data directory when one is available.

### `packages/host/authentication-token/src/index.ts:Config`
- `sessionGeneration`: Raise and reload the plugin to revoke every browser and API cookie at once; the signing secret is replaced. Default 0.

### `packages/jobs/tool-watch/src/index.ts:Config`
- `denyCommands`: JavaScript regular expressions; a watch command matching any is refused.
- `allowCommands`: JavaScript regular expressions; when non-empty, a watch command must match at least one.

### `packages/sandbox/sandbox-local/src/index.ts:Config`
- `requireFullEnforcement`: Refuse a built-in runner that reports partial enforcement instead of running on it. Default false.

### `packages/schedule/tool-schedule/src/index.ts:Config`
- `administrator`: When true the schedule tools reach every Host task instead of only tasks the calling Session is involved in. Default false.

### `packages/session/session-persistence-jsonl/src/index.ts:Config`
- `retention`: Opt-in deletion of sessions whose log was last written more than `maxAgeDays` days ago; absent deletes nothing.

### `packages/session/session-persistence-jsonl/src/index.ts:JsonlRetention`
- `maxAgeDays`: Age in days after the last write beyond which a session is deleted.
- `intervalHours`: Hours between retention sweeps after the sweep at mount; default 24.

### `packages/session/session-telemetry-otel/src/index.ts:Config`
- `redactSecrets`: Scrub recognisable secrets from exported bodies; default true.

### `packages/team/agent-team/src/index.ts:TeamService.pendingHistoricalMessages`
- `description`: List the historical Team messages of the caller's root Session that were sent before a restart and are not yet acknowledged.
- `params.caller`: Agent whose root Session's Team state is read.
- `returns`: The unacknowledged historical message snapshots; empty when none are pending.

### `packages/team/agent-team/src/index.ts:TeamService.recoverHistoricalMessage`
- `description`: Resolve one pending historical Team message by replaying it or discarding it; the acknowledgement is appended only after a replayed send was accepted. Throws TEAM_LEAD_REQUIRED unless the caller is the root Session.
- `params.caller`: Agent resolving the message; must be the root Session.
- `params.messageId`: The pending historical message to resolve.
- `params.decision`: `replay` sends the message again, `discard` drops it.
- `params.signal`: Cancels the replayed send.
- `returns`: What happened: replayed, discarded, already-delivered or already-resolved.

### `packages/api/remote-access/src/index.ts:RemoteAccessService.changes`
- `description`: Stream one notice per invalidate() that reaches the principal, coalesced until the reader pulls. The first pull registers the reader, so pull before reading the state to filter. The owner receives none. The stream ends when the signal aborts or this service unloads.
- `params.principal`: The caller identity to watch.
- `params.signal`: Cancels the stream.
- `returns`: An iterable yielding once per coalesced invalidation.

### `packages/api/session-controller/src/index.ts:SessionController.outline`
- `description`: Read one page of older turn-outline entries of a visible Session, newest first, bounded by `maxEntries`.
- `params.request`: The Session address, the exclusive `beforeSeq` cursor and the optional entry bound.
- `params.signal`: Cancels the read.
- `returns`: The outline entries of the page and the cursor for the next older page.

### `packages/feedback/command-feedback/src/index.ts:SessionFeedbackService.sharing`
- `description`: Report the live feedback sharing policy the feedback dialog shows.
- `returns`: The current sharing policy.

### `packages/credentials/deepseek-account/src/index.ts:DeepSeekAccount.getRevocationStatus`
- `description`: State of the background token revocation after sign-out.
- `returns`: none when no revocation ran, pending while one is in flight, otherwise its outcome.

### `packages/goal/goal/src/index.ts:GoalService.refundRound`
- `description`: Durably refund the admitted round the host or an unload aborted, keeping the goal's phase and activation. Refuses a stale ref, a goal with no admitted round and a completed goal.
- `params.agent`: Agent that owns the goal.
- `params.ref`: The goal reference the caller last observed.
- `returns`: The goal view after the refund.

### `packages/jobs/jobs/src/index.ts:JobRegistry.peek`
- `description`: Return what the next read returns and consume nothing: the model cursor does not move.
- `params.id`: The job to peek at.
- `params.caller`: The reading session checked against the owner.
- `returns`: The unconsumed read.

### `packages/core/tools/src/index.ts:ToolsService.preflight`
- `description`: Decide what a tool call would get from the hook, approval and guard pipeline without executing it.
- `params.input`: The tool execution input to evaluate.
- `returns`: The preflight decision for that call.

### `packages/core/agent-default-model/src/index.ts:AgentDefaultModelConfig.saveInitialSelection`
- `description`: Save a computed first-run default only while no selection was ever saved to the profile and none is submitted while the selection is being computed.
- `params.resolve`: Computes the selection to save, or undefined to leave the default alone.
- `returns`: Fulfillment after the optional profile write settles; resolves without writing when a selection was saved before or during the computation.

### `packages/workflow/workflow-ptc/src/index.ts:Config`
- `maxDurationMs`: Overall elapsed deadline for one workflow run in milliseconds; default 3,600,000 (one hour), 0 disables it. On expiry the run is aborted and settles as an error.

### `packages/api/quota-controller/src/index.ts:QuotaControllerInternals`
- `timeoutMs`: Deadline in milliseconds for one whole quota read, credential lookup plus HTTP request; default 30000.

### `packages/web/web-deepseek-api/src/index.ts:Config`
- `sendOriginalQuestion`: Send the initiating Session's latest human prompt, cut to 128 characters, as the Search API's `ori_question`; default false because it discloses prompt text the model did not put in its query.

### `packages/web/web-search-exa/src/index.ts:Config`
- `highlightsPerResult`: Most non-blank highlights joined into each result's snippet; no longer sent to Exa as the deprecated `highlightsPerUrl`. Defaults to 1.
