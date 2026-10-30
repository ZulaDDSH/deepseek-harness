---
description: "The one-shot Claude Code subagent provider for users and maintainers choosing a product backend, installing a Profile bundle, or configuring an unattended Claude Code delegation."
kind: "package-bundle"
---

# @deepseek-ai/dsh-subagent-claude-code

## Summary

Install this Profile Bundle when a delegated task should run as a fresh, unattended Claude Code session in the parent workspace. Each run accepts one self-contained text task and returns the final answer or a safe failure diagnostic; reasoning, tool traffic, stderr, usage, and workspace diffs stay out of the parent Session. Native Claude settings and authentication remain authoritative, while Profile configuration selects the model, environment, `permissionMode`, ultracode, and `agents`. The platform-pinned runtime starts on demand and never falls back to the host `claude` executable. Choose it when isolation and genuine Claude Code behavior matter more than continuation or prompts.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Enable **Claude Code subagent** in the Web or Desktop Plugins page when a task needs a fresh native Claude Code session in the parent workspace.

### Installing the Bundle

The Official entry is visible offline. Enabling it installs the [target for the running DSH installation](../../boot/plugin-manager/README.md#use-this-package) through the ordinary bundle installer and selects its profile layer. The layer registers the provider and adds `subagent_claude_code` to every Agent as a global tool; it starts no native process until delegation. Restart when the installer reports that one is required.

Switching Off deselects the layer and leaves the package installed. Remove is a separate package operation. Enabling or switching Off registers or removes the global tool in the running Host, so live Agents see the change on their next request.

The layer inserts Host rows only, so any profile can select it, including the shipped headless, SDK, and ACP profiles. Existing provider-only consumers follow the [upgrade guide](../../../docs/upgrade-guide/v0.2.1-alpha.1/native-subagent-bundle-tools/guide.md).

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `claude-code` | Non-empty registry name on `ctx.subagents`; each mounted instance needs a unique value |
| `model` | native Claude settings | Optional non-empty model name fixed for every run from this provider instance; omission sends no SDK override |
| `env` | `{}` | Explicit SDK/CLI environment layered over the credential-scrubbed parent environment |
| `permissionMode` | `dontAsk` | Native non-interactive permission policy fixed for every run from this provider instance |
| `ultracode` | native Claude settings | Profile default for native ultracode, sent only to a run whose model is a current Claude 5 family model (Opus, Sonnet, Haiku, or Fable 5.x: the aliases `opus`, `sonnet`, `haiku`, `fable` with or without `[1m]`, the full ids such as `claude-opus-5-5`, and their dated ids) (a run on any other model, or on one Claude Code picks itself, sends no ultracode setting); the delegating Session's Ultracode level overrides it for that run, and that run option comes from the nearest Session in the parent chain (up to 8 hops) that has one. When the resolved value is on, sends flag settings `ultracode` and `enableWorkflows` and pre-approves the `Workflow` tool only in `dontAsk` and `acceptEdits` modes. In `auto`, `plan`, and `bypassPermissions` the Workflow launch stays under native permission handling. When it is off, sends flag setting `ultracode: false` so native settings cannot turn it on; when neither the Session nor the Profile sets it, nothing is sent and native settings decide. Each pre-approved run makes the SDK emit a `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` process warning on host stderr |
| `agents` | none | Native custom subagents (`Options.agents`, the current SDK AgentDefinition fields, including `criticalSystemReminder_EXPERIMENTAL`) that each run's Agent tool and workflows can invoke; omitted optional fields stay omitted so the SDK applies its own defaults, and agent `permissionMode` accepts the five provider modes but not `default`; each agent's `mcpServers` entries are server-name strings or records of SDK `stdio`, `sse`, or `http` definitions, validated at load, and SDK in-process `sdk` entries are rejected because the provider registers no in-process servers |
| `disposeGraceMs` | `3000` | Grace between the shared managed-range owner's termination tiers |
| `timeoutMs` | none | Optional wall-clock limit in milliseconds for each published run; on expiry the run is cancelled and settles as an error with category `limit` and detail `exceeded timeoutMs (N ms)`. It does not bound SDK or CLI startup |
| `maxTurns` | SDK default | Optional positive integer passed as the SDK `maxTurns` option; reaching it settles the run as an error with category `limit` |
| `maxBudgetUsd` | SDK default | Optional positive finite USD spend limit passed as the SDK `maxBudgetUsd` option; reaching it settles the run as an error with category `limit` |

| `permissionMode` value | Native behavior |
|---|---|
| `dontAsk` | Deny operations that are not already authorized instead of prompting |
| `acceptEdits` | Accept file edits; any remaining permission prompt is denied by the unattended callback |
| `auto` | Let Claude Code's native classifier allow or deny permission requests |
| `plan` | Run in native planning mode, deny execution approval, and return the completed plan as the final answer |
| `bypassPermissions` | Explicitly set the SDK's dangerous confirmation and bypass permission checks |

The delegating parent Session's file sandbox also narrows the mode for every run. A read-only parent runs the child in `plan`. A workspace-write parent downgrades `bypassPermissions` and `auto` to `acceptEdits`, including the modes of Profile `agents`. A danger-full-access parent keeps the configured mode. The narrowing is logged on the Host and appended to failure diagnostics as a safe fact that names the configured and effective modes. A Profile agent narrowed on its own, with the provider mode unchanged, is named in the same note, for example `agent helper permission mode narrowed from bypassPermissions to acceptEdits`.

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-subagent-claude-code) is the exhaustive source for every accepted field and its JSDoc. Each run's `effort` is the delegating Session's Claude Code effort run option (`low`, `medium`, `high`, `xhigh`, or `max`) when set; otherwise it is omitted and Claude settings decide. The provider registers the `claudeCodeRunOptions` presence key, so clients show the Claude Code run controls only while a Claude Code provider is installed; the per-Session `runOptions` projection they read is registered by `dsh-api-session-controller` for every Session. The Session's fast-mode toggle is sent as flag setting `fastMode` when set. A configured `model` passes unchanged to every query from that provider instance; omission leaves native model selection in force. Credential-shaped ambient variables are removed before the explicit `env` overlay, so an API key intended for the child must be supplied there. The provider omits the SDK `settingSources` option, so Claude Code reads the host's normal user, project, and local settings relative to the selected child working directory. It does not copy or filter those files, create or modify login state, inspect `PATH`, or fall back to a host `claude` executable.

### Skills

Because the provider omits `settingSources`, the child discovers native Claude Code skills from `<cwd>/.claude/skills`, `~/.claude/skills` (or `$CLAUDE_CONFIG_DIR/skills`), and plugins. Runs in `dontAsk` and `acceptEdits` pass the SDK option `skills: 'all'`, which enables every discovered project, user, and plugin skill and pre-approves the `Skill` tool the same way ultracode pre-approves `Workflow`; like that pre-approval, it makes the SDK emit a `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` process warning on host stderr. Without it, the CLI denies `Skill` calls in `dontAsk`. Project `.claude` skills belong to the project settings scope the provider already loads, and a skill's `allowed-tools` frontmatter can pre-approve tools while that skill runs unless managed settings disable it. `auto` and `plan` do not pass `skills`, so a `Skill` request there takes native permission handling, and the unattended callback denies any request that reaches it.

<a id="exposing-the-tool"></a>
### Exposing the tool

The bundle inserts `tool-subagent-claude-code` as a Host row, so `subagent_claude_code` is a global tool visible to every preset, including minimal. Later user patches can configure or disable that row by id. A preset that registers its own tool with the same name shadows the global tool for its Agents. To mount the provider and tool without selecting the bundle layer, insert the same rows in `cordis.patch.yml`:

```yaml
- insert:
    - id: subagent-claude-code
      name: '@deepseek-ai/dsh-subagent-claude-code'
    - id: tool-subagent-claude-code
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: claude-code
        toolName: subagent_claude_code
        maxDepth: provider-managed
```

The tool returns a child id after accepting the task and sends its result to the parent Agent on completion. Each external activation executes once and accepts no follow-up input or resume.

### What you get

The completion notice contains the final Claude Code answer, or the stop reason and optional safe diagnostic. The parent Session also retains the external task identity and complete terminal result independently of the notice; no local child Session is created. Product reasoning, tool activity, raw stderr, and workspace diffs do not enter the parent Session.

### Failure and recovery

An install that omits optional dependencies, uses an unsupported platform, or loses the selected payload leaves the provider dormant and fails the first delegation at the SDK startup boundary with a safe `query-start` / `unknown` failure fact; there is no host-CLI fallback. The original product error stays on the internal cause chain and in the provider's Host log. A cancelled run settles as `aborted`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the provider drives a real Claude Code CLI and where the observable behavior comes from; the full contract lives in [Use this package](#use-this-package).

### Design concept

- **One fresh query per run.** Every run has an independent SDK query, cancellation controller, CLI process, and non-persisted product session; there is no continuation, resume, or pooling.
- **Native settings are authoritative.** The provider deliberately omits the SDK `settingSources` option, so Claude Code reads the host's normal user, project, and local settings; an optional `model`, the required `permissionMode`, the optional `agents`, and the Claude Code effort, fast-mode, and ultracode run options are the only query-level overrides. Run options come from the nearest Session in the delegating parent's chain, up to 8 parent hops, that has them.
- **Unattended by design.** `AskUserQuestion` is disabled and permission prompts are denied except in bypass mode, so the query never waits for a user interface.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, provider registration |
| [`src/run.ts`](src/run.ts) | The SDK query lifecycle, result acceptance, and permission handling |
| [`src/process.ts`](src/process.ts) | Managed-range termination escalation on disposal |
| [`cordis.patch.yml`](cordis.patch.yml) | The Profile layer that registers the provider and contributes preset delegation tools |

### Run flow

A start accepts only a non-empty sequence of text blocks and derives the child cwd from the parent session. It creates a private `AbortController`, calls the official SDK `query()` with the exact concatenated task, and publishes the run only after the SDK's custom-spawn hook has supplied a live CLI handle owned by the subprocess seam. The provider iterates the complete message stream and accepts only a `result` message with `subtype: "success"`, `is_error: false`, and a nonblank `result`, followed by normal iterator completion. Every other outcome maps to a fixed-category `error` diagnostic naming the lifecycle stage and observed process outcome — the category set lives in [`src/sdk-messages.ts`](src/sdk-messages.ts) and [`src/run.ts`](src/run.ts). Local cancellation wins the result race and maps to `aborted` without a failure diagnostic.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this provider to the seam it plugs into and the sibling product provider.

- [Subagent subsystem](../../../docs/subsystems/subagent.md) — the service contract, provider contract, and terminal result semantics.
- [dsh-subagent seam](../subagent/README.md) — the registry and start API this provider registers on.
- [Codex subagent provider](../subagent-codex/README.md) — the sibling product backend over the official app-server protocol.
- [historical Claude Code and Codex backends](../../../.agents/notes/archived/feature/2026-08-04-claude-code-and-codex-subagent-backends.md) — the design record for the product providers.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-subagent-claude-code) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Child request

#### What the model sees

The Claude Code child receives the standalone text task as one fresh SDK query. Its workspace is the selected child working directory; the selected provider instance fixes the query's environment, non-interactive permission mode, and configured model, unless an Orchestrator & Subagent Setup role route passes a per-run model and effort, which run-selection validates before the run starts, while an omitted model and every other product setting come from native Claude configuration. The executable version comes from the Bundle's pinned SDK platform payload.

#### Token effect

The child pays for an independent Claude Code context and query. Child tokens do not enter the parent's context.

#### KV Cache effect

Independent of the parent request cache. Reuse depends only on Claude Code's own model, instructions, tools, native settings, and fresh query.

### Parent scheduling and results, indirectly

#### What the model sees

Through `dsh-tool-subagent`, the parent model first receives a child id, then the final Claude Code answer or a failure notice with its stop reason and safe diagnostic. Diagnostics contain only fixed stage, category, and observed protocol or process facts. Product reasoning, intermediate messages, tool activity beyond the advisory progress lines noted under Known Limitations, stderr, usage, product identifiers, commands, paths, and raw protocol payloads are not copied into the parent Session.

#### Token effect

Parent input grows by the start acknowledgement and completion notice, including the final answer or failure detail. Child tokens do not enter the parent context. This provider adds no parent tool schema by itself.

#### KV Cache effect

Start acknowledgements and completion notices append after the reusable parent request prefix. A notice may wake another turn without rewriting the existing prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this provider is a poor fit or needs special operational care. They are current package constraints, not a general Claude Code comparison or a task backlog.

- **One fresh query and process per run** — there is no continuation, resume, pooling, or product-session persistence. Only advisory tool-use progress lines (the tool name with its `file_path`, `command`, or `pattern` input) reach a request's `onProgress`, which background jobs show; the shared progress sink rate-limits and truncates them, and they are not part of the final answer.
- **Static instance selection** — Profile rows fix provider names, optional models, and tool bindings; calls cannot choose a provider or change the model, except that a Orchestrator & Subagent Setup role route passes a per-run model and effort; every exposed tool needs a unique `toolName`.
- **Host settings are intentionally authoritative** — when `model` is omitted, project and user settings choose it; native settings always retain the remaining tools and behavior, and the provider does not provide a filtered or hermetic production mode.
- **Authentication and account state remain native** — the Bundle supplies the CLI but does not create an account, log in, or rewrite Claude settings. Sign-in, organization-policy, account-hold, verification, and cloud-credential failures classify as `access-policy`; billing, rate-limit, and max-output failures as `limit`; overload and server errors as `service`; and model or request errors as `product-error`. When the assistant reports the error code, the diagnostic carries it as `detail`, plus an ISO reset time for a rate limit whose reset the SDK reports. Other configuration failures keep the lifecycle stage and the safe `unknown` fallback.
- **The SDK platform payload is required at delegation time** — installs that omit optional dependencies, unsupported platforms, and missing or damaged payloads fail at the first query; there is no host-CLI fallback.
- **No human interaction path** — `AskUserQuestion` is disabled, permission prompts are denied, MCP elicitation is declined, and blocking dialogs fail closed instead of suspending.
- **Assistant payload is final text only** — failed runs can also expose a separate safe diagnostic; reasoning, intermediate messages, tool traffic, usage, stderr, and workspace diffs remain outside the parent Session. Task identity and terminal results are retained in the parent log.
- **Ultracode and custom agents run inside the one child** — only the SDK's final result reaches the parent, cancellation or disposal terminates the child's process tree, and ultracode needs a Claude account or plan with Workflows that managed settings do not disable, plus a model that supports ultracode; token use can be much higher.
- **Agent `permissionMode` is operator-owned** — a Profile-fixed agent can set `acceptEdits` or `bypassPermissions` even when the provider runs `dontAsk` or `plan`, so configure agent modes with the same care as the provider mode. The parent sandbox clamp covers agent modes as well: under a read-only parent every agent runs in `plan`, and under a workspace-write parent an agent's `bypassPermissions` or `auto` becomes `acceptEdits`. A danger-full-access parent passes agent modes through unchanged.
- **No optional shared capabilities** — `agentPreset`, `agentOptions`, output schemas, and harness depth enforcement are rejected by the shared service for this provider.
- **No side-effect rollback** — the caller cancels long work, and files or external systems changed before cancellation are not restored. The optional `timeoutMs` bounds only the published run, not SDK or CLI startup, and it is unset by default.
- **DSH-only skills are invisible to the child** — skills that exist only in DSH roots (`.dsh/skills`, `.agents/skills`, custom or bundled roots) are not visible to the Claude Code child, which reads only the native Claude Code skill locations.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

- **Payload size disclosure** — the current darwin-arm64 platform payload packs to about 92 MB and unpacks to about 325 MB; these are disclosure numbers, not installation thresholds.
- **Version-pinned protocol** — the runtime dependency is pinned to Agent SDK 0.3.296; upgrading pins a new SDK version and requires re-running the keyless real-product and loader-composition evidence.

</details>
