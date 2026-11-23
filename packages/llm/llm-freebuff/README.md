---
description: "The Freebuff model route for users and maintainers who want to chat with the installed Freebuff CLI as a model, sign in through the settings page, and understand how the harness drives its terminal."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-freebuff

## Summary

Install `@deepseek-ai/dsh-llm-freebuff` when a Session should talk to the user's own installed Freebuff CLI as if it were a model. The package adds a `freebuff` provider route with one model, `default` (shown as Freebuff), and a Freebuff row in the models settings page whose **Sign in with Freebuff** button runs `freebuff login`. Freebuff keeps its own account and token: the package never reads, copies or stores a Freebuff credential, it only stores a marker that says "Freebuff reports a saved sign-in". Each harness Session owns one persistent Freebuff terminal in the Session's workspace, so Freebuff keeps its own chat, tools and history.

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

Install the Freebuff CLI first and make `freebuff` resolvable on `PATH`. Mount the package in a Profile:

```yaml
- insert:
    - id: llm-freebuff
      name: '@deepseek-ai/dsh-llm-freebuff'
```

### Signing in

Open the models settings page, choose the Freebuff row and press **Sign in with Freebuff**. The flow runs `freebuff login`, shows the first `https` link it prints, and finishes only when `freebuff doctor --json` reports a saved sign-in. Every other line the login prints is dropped, because it names the account. Signing in or out outside the harness is picked up within 30 seconds, when the model list is read, and when the plugin starts. The model is listed only while Freebuff reports a sign-in.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `idleReapMs` | `600000` | How long a Session's idle terminal stays alive before it is closed; the next turn reopens it with `--continue`. Applies without a restart. |

### What a turn does

The newest user-typed message is pasted into the Session's Freebuff terminal and the reply is streamed back as text, reasoning and short markdown lines for the tools Freebuff ran. Tools, system prompt and earlier history in the request are ignored because Freebuff keeps its own history. A prompt starting with `/` or `!`, and any image or file, is rejected.

### Hours left

On Windows the package registers a quota source with id `freebuff`, so the session-header usage popover shows today's hours left (h:mm, counting the unused part of a running open hour) and the monthly hours for a session on Freebuff. It reads `GET https://www.codebuff.com/api/v1/freebuff/session` with the Freebuff token from Credential Manager, caches the usage for five minutes, and reports an error rather than zero hours when the read fails. macOS and Linux report not configured.

### Failure and recovery

| Failure | Code | When |
|---|---|---|
| Freebuff executable not found | `INVALID_CONFIG` | A turn or the sign-in starts |
| Freebuff shows its login screen | `ACCOUNT_SIGN_IN_REQUIRED` | A turn; the stored marker is deleted |
| Freebuff refuses the prompt (`userError` or an error row) | `UNKNOWN` | Freebuff's text is passed through unchanged |
| Freebuff exits mid-turn | `STREAM_CLOSED` | The next turn starts a new terminal |
| Freebuff asks a question or waits on a prompt | `UNKNOWN` | The turn fails |
| Background request, sandboxed Session, missing session | `UNSUPPORTED_OPTION` / `INVALID_REQUEST` | Before any terminal starts |

The route declares no retries: a retry would paste the prompt into a chat that already holds it and could spend paid Freebuff time.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

- **A real terminal, not a protocol.** Freebuff has no machine interface, so the package spawns it with `ctx.subprocess.spawnTerminal` and renders the output with `@xterm/headless` to read its state markers.
- **The chat file is the answer.** Freebuff writes each chat under its configuration directory; the package reads that file to stream the reply and to tell a finished turn from a working one.
- **The harness never rewrites Freebuff.** Freebuff's usage-policy refusals reach the user verbatim.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry, configuration, registration |
| [`src/auth.ts`](src/auth.ts) | Sign-in flow and marker reconciliation |
| [`src/doctor.ts`](src/doctor.ts) | `freebuff doctor --json` tri-state probe |
| [`src/adapter.ts`](src/adapter.ts) | The model route, prompt selection and replay state |
| [`src/session.ts`](src/session.ts) | Terminal pool, turn loop, cancel |
| [`src/chat.ts`](src/chat.ts) | Locating and reading chat files |
| [`src/markdown.ts`](src/markdown.ts) | Rendering Freebuff's blocks as markdown |
| [`src/screen.ts`](src/screen.ts) | Emulator wrapper and screen markers |
| [`src/launch.ts`](src/launch.ts) | Windows shim wrapping, ANSI stripping, config directory |
| [`src/environment.ts`](src/environment.ts) | Machine facts and timing |

### Turn flow

A turn takes the newest user text, opens or reuses the Session's terminal (`--cwd <workspace>`, plus `--continue <chat id>` after a respawn), answers the project trust prompt `n`, pastes the text in bracketed paste and presses Enter. The first turn of a Session binds its chat while a process-wide lock is held: the new chat directory whose first user row equals the prompt. The loop polls every 250 ms, streams the growth of the rendered reply, and finishes when the working indicator has been quiet and the chat's last reply is complete. The assistant message carries `{ kind: 'freebuff', version: 1, chatId, consumed }` as replay state so a restarted harness resumes the chat and never submits a prompt twice.

### Verified and unverified markers

Only the fake Freebuff in `tests/` was run against this code. See the Dev Note.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Freebuff subagent provider](../../subagent/subagent-freebuff/README.md) — the one-shot delegation backend over the same CLI.
- [dsh-llm](../llm/README.md) — the adapter contract this route implements.
- [Authorization seam](../../credentials/authorization/README.md) — the flow registry behind the sign-in button.

-----

<a id="model-experience"></a>
## Model Experience

### Model request

#### What the model sees

Only the newest user-typed text reaches Freebuff, as one pasted message. Freebuff chooses its own model and tools.

#### Token effect

Replies carry no token counts; the work is paid from the user's Freebuff subscription and free hours.

#### KV Cache effect

None for the harness: the harness request is not what Freebuff receives.

### Tools

The harness tool list is not sent. Freebuff runs its own tools in the workspace and the reply shows them as short markdown lines.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No sandbox** — Freebuff edits files and runs commands with the user's rights, so a Session whose file sandbox is not `danger-full-access` is refused.
- **Usage-policy refusals** — Freebuff's server may refuse prompts that another program drives. The package does not disguise the prompt or work around the check; the refusal is raised as an error with Freebuff's own text.
- **Edits and regenerate do not rewind Freebuff** — Freebuff keeps its own chat. An edited earlier message or a regenerated reply does not remove what Freebuff already did, and a regenerate of an answered prompt shows the existing reply instead of asking again.
- **Paid hours and idle terminals** — a live terminal can keep a Freebuff session open; at most two run at once and an idle one is closed after `idleReapMs`.
- **Screen markers** — completion and the login, trust and blocker screens depend on strings in the Freebuff TUI; a release that changes them makes turns fail at a timeout.
- **No second question** — a Freebuff question to the user fails the turn.
- **Slash commands** — prompts beginning with `/` or `!` are rejected.
- **Windows shims** — a `.cmd` shim is started through `ComSpec`; a workspace path containing `& | < > ^ % "` is refused.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

- **Unverified against real Freebuff** — the login URL on a non-terminal stdout, `--continue <id>` reusing the same chat directory, the Escape interrupt, long-paste attachment handling and `.cmd` pseudo-terminal start were only exercised against a fake.
- **Replay state extension** — `consumed` extends the minimal `{ kind, version, chatId }` replay state.
- **Declaration docs** — exported declarations carry no multi-line JSDoc because the edit hook rejects it.

</details>
