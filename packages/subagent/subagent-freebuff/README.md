---
description: "The one-shot Freebuff subagent provider for users and maintainers choosing a product backend, installing a Profile bundle, or delegating a task to the installed Freebuff terminal application."
kind: "package-bundle"
---

# @deepseek-ai/dsh-subagent-freebuff

## Summary

Install `@deepseek-ai/dsh-subagent-freebuff` into a Profile when delegated work should run in the user's own installed Freebuff CLI, in the parent Session's workspace. Freebuff is an interactive terminal application with no prompt argument, one-shot mode, ACP mode or server mode, so the provider starts the real `freebuff` binary in a pseudo-terminal, types one self-contained text task into it, waits for the turn to finish, and returns only the selected answer or a safe failure diagnostic. Freebuff keeps its own account: the user signs in once with `freebuff login`, and the provider never reads, copies, proxies or stores a Freebuff credential. The Bundle adds its delegation tool as a global tool.

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

Enable **Freebuff subagent** in the Web or Desktop Plugins page when a task needs a fresh Freebuff session in the parent workspace. The package does not install Freebuff: install the CLI first and make `freebuff` resolvable on `PATH`, or set `executable` to its absolute path.

### Logging in

Freebuff stores its token in the operating-system keychain and refuses use through its SDK, so the login step is always the user's own:

1. Open a terminal as the same operating-system user that runs DSH.
2. Run `freebuff login` and finish the browser flow.
3. Optionally confirm with `freebuff doctor`; the report's sign-in section reads `A sign-in is saved`.

Before every run the provider runs `freebuff doctor --json` and reads only the sign-in finding ids. A signed-out, empty, corrupt or unreadable sign-in fails the delegation before any terminal starts with a not-logged-in error whose text tells the user to run `freebuff login`. The provider also watches the terminal after launch: a login screen or an expired token shown by Freebuff fails the run with the same error. A doctor that cannot run does not block a run, because the terminal check still applies. Set `loginCheck: false` to skip the doctor call.

Do not set `FREEBUFF_CONFIG_DIR` in `env`: Freebuff keys its keychain entry by the credentials path, so a relocated directory signs the child out.

### Installing the Bundle

The Official entry is visible offline. Enabling it installs the [target for the running DSH installation](../../boot/plugin-manager/README.md#use-this-package) through the ordinary bundle installer and selects its profile layer. The layer registers the provider and adds `subagent_freebuff` to every Agent as a global tool; it starts no process until delegation. Restart when the installer reports that one is required.

Switching Off deselects the layer and leaves the package installed. Remove is a separate package operation. The layer inserts Host rows only, so any profile can select it, including the shipped headless, SDK, and ACP profiles.

### Using Freebuff as an agent

Freebuff is a delegated backend, the same kind as Codex and Claude Code. The model calls `subagent_freebuff` with a task; the tool returns the child's name after accepting it and sends the result to the parent Agent on completion. Each activation executes once and accepts no follow-up input or resume. The Plugins page lists it beside **Codex subagent** and **Claude Code subagent**, and the shipped economy preset carries a disabled `tool-subagent-freebuff` row next to theirs.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `freebuff` | Non-empty registry name on `ctx.subagents`; each mounted instance needs a unique value |
| `executable` | `freebuff` | Executable name resolved on the scrubbed `PATH`, or an absolute path |
| `cwd` | parent Session workspace | Optional absolute directory that replaces the parent workspace as the child's working directory |
| `args` | `[]` | Extra arguments placed after the executable and before any provider flag |
| `env` | `{}` | Explicit child environment layered over the credential-scrubbed parent environment |
| `trustAgents` | `false` | Pass `--trust-agents` so project agents load without the trust prompt; when `false` the provider answers the prompt `n` |
| `loginCheck` | `true` | Run `freebuff doctor --json` before each run |
| `startupTimeoutMs` | `60000` | Bound on the doctor call, on reaching the ready screen, and on Freebuff starting to work after the task is sent |
| `idleMs` | `2500` | Time without a working indicator before a turn counts as finished |
| `timeoutMs` | `1800000` | Wall-clock limit for the published run; on expiry the run is cancelled and settles as an error with category `limit` and detail `exceeded timeoutMs (N ms)` |
| `disposeGraceMs` | `3000` | Grace for terminating the terminal session |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-subagent-freebuff) is the exhaustive source for every accepted field.

`trustAgents` stays off by default because project agents execute repository-supplied configuration. Freebuff has no sandbox or approval switch, so a delegating parent whose file sandbox is `read-only` or `workspace-write` is refused with `PARENT_SANDBOX_MISMATCH` before anything starts; a `danger-full-access` parent or an absent sandbox policy is accepted.

<a id="exposing-the-tool"></a>
### Exposing the tool

The bundle inserts `tool-subagent-freebuff` as a Host row, so `subagent_freebuff` is a global tool visible to every preset, including minimal. To mount the provider and tool without selecting the bundle layer, insert the same rows in `cordis.patch.yml`:

```yaml
- insert:
    - id: subagent-freebuff
      name: '@deepseek-ai/dsh-subagent-freebuff'
    - id: tool-subagent-freebuff
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: freebuff
        toolName: subagent_freebuff
        maxDepth: provider-managed
```

### What you get

The completion notice contains the selected Freebuff answer, or the stop reason and a safe diagnostic. Diagnostics name only a fixed stage and category, never terminal text. The parent Session retains the external task identity and complete terminal result; no local child Session is created. Freebuff's reasoning, tool activity and workspace diffs do not enter the parent Session.

### Failure and recovery

| Failure | Code | Raised |
|---|---|---|
| The executable is not found | `FREEBUFF_NOT_INSTALLED` | Before any process starts |
| Freebuff is not logged in | `FREEBUFF_NOT_LOGGED_IN` | Before launch from doctor, or at launch from the login screen |
| Freebuff exits, waits on an admission prompt, never becomes ready, reports an error or times out | `FREEBUFF_RUN_FAILED` | At startup, or as the error result of a published run |

A startup failure rejects the delegation. A failure after the run is published settles as `stopReason: error` with the diagnostic. A cancelled run settles as `aborted` and terminates the terminal session. The provider never confirms an admission prompt such as taking over another session or confirming a send, because those spend session capacity; sign out of the other terminal or finish the pending prompt and retry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the provider drives the Freebuff TUI and where each signal comes from; the full contract lives in [Use this package](#use-this-package).

### Design concept

- **A real terminal, not a protocol.** Freebuff exposes no machine interface, so the provider spawns the binary through `ctx.subprocess.spawnTerminal` and renders its output with `@xterm/headless`, the emulator the persistent terminals use. Screen state is classified from the rendered rows, never from raw escape bytes, and the emulator's replies to terminal queries return to the child because the TUI asks for terminal capabilities at startup.
- **Structured signal first.** When the persisted chat transcript is found, completion and the answer come from its last assistant message. Without it, completion is the working indicator going quiet for `idleMs` with the ready footer back, and the answer is the screen text after the echoed task.
- **No credential handling.** The provider uses no Freebuff SDK, reads no keychain or credentials file, and proxies no Freebuff API.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, provider registration, pre-start checks |
| [`src/run.ts`](src/run.ts) | The run lifecycle: spawn, ready wait, task paste, turn wait, cancellation, teardown |
| [`src/screen.ts`](src/screen.ts) | Emulator wrapper and screen classification |
| [`src/transcript.ts`](src/transcript.ts) | Locating and reading the persisted chat transcript |
| [`src/login.ts`](src/login.ts) | The doctor-based sign-in check |
| [`src/errors.ts`](src/errors.ts) | Typed failures |
| [`cordis.patch.yml`](cordis.patch.yml) | The Profile layer that registers the provider and its delegation tool |

### Run flow

A start accepts only text blocks, removes control characters other than newline and tab, resolves the executable, runs the doctor check, and spawns the terminal at 120 by 50 cells. It waits for the ready footer, answering the project-agents trust prompt `n` unless `trustAgents` is set, then publishes the run. The published result pastes the task with bracketed-paste markers so embedded newlines do not submit early, presses Enter, and polls the screen and transcript until the turn ends. Completion terminates the terminal session at once; the delegation manager's disposal then waits for quiescence.

### Verified and unverified markers

The screen markers (`Press ENTER to login...`, `thinking...`, `working...`, `■ Esc`, `/model to change`, `for history`, `Enter: take over`, `Load and run these? [y/N]`) and the transcript layout were read from the Freebuff CLI source. They are not checked against a running binary; the tests drive a fake terminal script that prints the same markers.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Subagent subsystem](../../../docs/subsystems/subagent.md) — the service contract, provider contract, and terminal result semantics.
- [dsh-subagent seam](../subagent/README.md) — the registry and start API this provider registers on.
- [Codex subagent provider](../subagent-codex/README.md) — the sibling product backend over the official app-server protocol.
- [Claude Code subagent provider](../subagent-claude-code/README.md) — the sibling product backend over the official Agent SDK.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-subagent-freebuff) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Child request

#### What the model sees

The Freebuff child receives the standalone text blocks, joined by blank lines, as one pasted message in a fresh Freebuff chat. Its workspace is the selected child working directory; its model, agents and settings come from the user's own Freebuff installation.

#### Token effect

The child pays for an independent Freebuff context and turn under the user's Freebuff subscription. Child tokens do not enter the parent's context.

#### KV Cache effect

Independent of the parent request cache; reuse depends only on Freebuff's own request construction.

### Parent scheduling and results, indirectly

#### What the model sees

Through `dsh-tool-subagent`, the parent model first receives the child's name, then the selected Freebuff answer or a failure notice with its stop reason and safe diagnostic. Diagnostics contain only a fixed stage and category. Terminal text, reasoning, tool activity, paths and product identifiers are not copied into the parent Session.

#### Token effect

Parent input grows by the start acknowledgement and completion notice, including the answer or failure detail. This provider adds no parent tool schema by itself.

#### KV Cache effect

Start acknowledgements and completion notices append after the reusable parent request prefix; a notice may wake another turn without rewriting the existing prefix.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

These limits define when this provider is a poor fit or needs special operational care.

- **Screen scraping is the fallback** — Freebuff has no machine-readable done signal, so the provider depends on the TUI markers listed above. A Freebuff release that changes them makes runs fail at a timeout, never hang, but the provider needs updating.
- **The screen answer may be clipped** — without a persisted transcript the answer is the rendered text, which is limited to the 50-row viewport. The transcript is found only when Freebuff stores chats under `<config dir>/projects/<basename of the workspace>/chats`; a different project root name falls back to the screen.
- **One fresh process and one turn per run** — there is no continuation, resume or pooling. Progress lines are not forwarded.
- **A paused question or a waiting room ends at a timeout** — a Freebuff question to the user, or a free-tier waiting room, has no recognised marker, so the run ends at `timeoutMs` or `startupTimeoutMs`.
- **No sandbox and no approval path** — Freebuff edits files and runs commands with the user's rights, so only `danger-full-access` parents are accepted.
- **Windows is unverified** — the provider passes a `.cmd` shim from `PATH` straight to the pseudo-terminal and wraps it in `ComSpec /d /s /c` for the doctor call; neither path was run on Windows. ConPTY sessions sit outside Job containment, so descendant cleanup relies on the terminal handle's termination.
- **A concurrent Freebuff in the same project can confuse transcript lookup** — the newest chat written after the run started is taken.
- **No optional shared capabilities** — `agentPreset`, `agentOptions`, output schemas and harness depth enforcement are rejected by the shared service for this provider.
- **No side-effect rollback** — files changed before cancellation are not restored.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

- **Marker verification** — run a real Freebuff once under the provider and record the actual footer, working indicator and admission strings; the table in `src/screen.ts` is the only place to change.
- **Launcher update restart** — the npm launcher can restart itself after an update; whether that surfaces as an early exit under the pseudo-terminal is unobserved.

</details>
