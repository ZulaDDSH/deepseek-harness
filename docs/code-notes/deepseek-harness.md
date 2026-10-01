# DeepSeek Harness code notes

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
