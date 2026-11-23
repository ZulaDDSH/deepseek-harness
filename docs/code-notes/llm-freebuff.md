# llm-freebuff code notes

## Launch and doctor

`packages/llm/llm-freebuff/src/launch.ts:freebuffLaunch`: a Windows `.cmd` or `.bat` shim cannot be spawned directly (Node refuses it) and `cmd /s /c "<quoted path>" args` mis-parses a path that contains a space. The shim path travels in the `DSH_FREEBUFF_EXE` environment variable already wrapped in quotes and the command line names it as `%DSH_FREEBUFF_EXE%`, so `cmd` expands it into one correctly quoted program token. Arguments are passed through unchanged, which is why an argument containing a `cmd` metacharacter (`& | < > ^ % "`) is rejected before launch.

`packages/llm/llm-freebuff/src/launch.ts:freebuffConfigDir`: copied from `subagent-freebuff` (`transcript.ts:freebuffConfigDir`). The package is deliberately self-contained so the two packages can change independently. Freebuff keys its keychain entry by the credentials path, so the harness never sets `FREEBUFF_CONFIG_DIR` itself; it only honours an absolute value that the user already exported.

`packages/llm/llm-freebuff/src/doctor.ts:doctorStatus`: `freebuff doctor --json` is the only sign-in probe. It reads finding ids and nothing else (the report holds paths and platform facts). The result is a tri-state because a doctor that cannot run says nothing about the sign-in: `unknown` never creates or deletes the stored marker.

## Sign-in

`packages/llm/llm-freebuff/src/auth.ts:FreebuffAccount.flow`: `freebuff login` prints a browser URL and, after the human finishes, a success line that names the account and e-mail address. Only the first `https` URL is relayed through `session.notify`; every other output line is dropped, because the success line is personal data. A failed login reports only the exit code. Success is decided by a follow-up `doctor --json` returning `auth.ok`, not by the exit code alone. The committed grant is the fixed marker `{ via: 'freebuff-cli' }`; the credential store notifies observers on every write, so a repeat sign-in needs no varying payload.

`packages/llm/llm-freebuff/src/auth.ts:FreebuffAccount.reconcile`: the credential record is a marker for the settings surface, not a secret. Freebuff owns the real token. The marker follows the doctor: signed-in without a record writes one, signed-out with a record deletes it, `unknown` changes nothing. The doctor answer is cached for 30 seconds, refreshed to signed-in right after a successful login, and a delete never runs while a sign-in attempt for the key is in flight, so a stale "signed-out" answer cannot remove a fresh grant.

## Environment

`packages/llm/llm-freebuff/src/environment.ts:defaultEnvironment`: everything the package reads from the machine (executable lookup, config directory, home directory, platform, `ComSpec`, timing) sits in one record so tests substitute a fast clock and a fake executable without patching modules. A missing `freebuff` executable becomes `INVALID_CONFIG` for a turn and `unknown` for the sign-in probe, because a probe that cannot run says nothing about the sign-in.

`packages/llm/llm-freebuff/src/environment.ts:probeSignIn`: runs `freebuff doctor --json` from the home directory, never from a workspace.

## Chat files

`packages/llm/llm-freebuff/src/chat.ts:readChat`: Freebuff persists one directory per chat under `<config dir>/projects/<basename of the workspace>/chats/<timestamp>/chat-messages.json`. The file is rewritten as a whole, not appended, and may be read half-written, so a parse failure is treated as "not there yet". Row shapes seen in real files: `variant` `ai` (blocks of type `text` with `textType` `text` or `reasoning`, `tool`, `mode-divider`, `ask-user`; `isComplete` once finished; `userError` when Freebuff refuses to send), `user` (`content`, optional `validationErrors`) and `error`. A chat starts with a `mode-divider` row that has `variant` `ai`, so the first user row, not the first row, identifies a chat.

`packages/llm/llm-freebuff/src/chat.ts:bindChat`: several harness sessions can share a workspace basename, and the user may run Freebuff in the same folder. A new chat is bound only while the process-wide mutex is held, by taking the directory that was absent from the snapshot taken before the first submit and whose first user row equals the prompt after whitespace squashing (the TUI re-wraps pasted text). Equality on the prompt is the discriminator; a single new directory is not enough on its own.

## Markdown rendering

`packages/llm/llm-freebuff/src/markdown.ts:renderBlocks`: the harness cannot show Freebuff's tool UI, so each tool block becomes a short markdown line. Output grows by appending only, because stream deltas cannot retract text: a tool block is rendered only after it has a successor or its message is complete, since its output and the closing code fence would otherwise change text that was already streamed. Consecutive text and tool blocks merge into one text block, reasoning blocks merge into one reasoning block, and a `mode-divider` block renders nothing.

## Session pool

`packages/llm/llm-freebuff/src/session.ts:FreebuffPool`: one pseudo-terminal per harness session id, at most two live at once. A session that is not running a turn is reaped after `idleReapMs`; the session object keeps its chat id and consumed marker, so the next turn respawns with `--continue <chat id>`. The mutex serialises spawn, first submit and chat binding across all sessions; it is released as soon as the chat is bound.

`packages/llm/llm-freebuff/src/session.ts:FreebuffSession.runTurn`: a reused terminal still shows the previous turn as finished, so a turn only renders and finishes once a user row that was not present before the submit exists. The prompt is never submitted twice: if a user row with the same text already follows the last consumed message of the chat, that row is the turn (retry after a failure or a respawn). The consumed marker is the id of the last chat message at the end of a successful turn and is returned to the harness inside the assistant message's replay state (`chatId`, `consumed`), which is a design extension of the minimal `{ kind, version, chatId }` envelope.

`packages/llm/llm-freebuff/src/session.ts:FreebuffSession.interrupt`: cancel sends Esc, waits a few seconds for the working indicator to clear and otherwise terminates the terminal. A terminal that stopped working is kept. Either way the cancelled turn is marked consumed (the last chat row id), so a later identical prompt is submitted again instead of being matched to the half-finished row.

## Adapter

`packages/llm/llm-freebuff/src/adapter.ts:promptOf`: only the newest user-sourced message is the prompt. System prompt, tools and earlier history are ignored because Freebuff keeps its own history in its chat. A prompt that starts with `/` or `!` is rejected so a user message cannot run a TUI command or a shell line. Images and files are rejected rather than dropped.

`packages/llm/llm-freebuff/src/adapter.ts:FreebuffAdapter.stream`: requests with a `purpose` (compaction, auto-review, timeline) are refused because they would be pasted into the user's visible Freebuff chat. Freebuff has no sandbox, so a parent session whose sandbox is not `danger-full-access` is refused. Freebuff's own refusals (`userError`, the `error` variant) are thrown with Freebuff's text unchanged.

`packages/llm/llm-freebuff/src/adapter.ts:FreebuffAdapter.providerRetryPolicy`: a retry would paste the prompt again into a chat that already holds it and could spend paid Freebuff hours, so the route declares zero retries.

## Settings row

`packages/llm/llm-freebuff/src/index.ts:apply`: the provider directory entry reports OAuth native authentication so the models settings row offers the registered `Sign in with Freebuff` method. The settings surface finds the flow whose key ends with `/<provider>`, which is why the credential key is `llm-freebuff/freebuff`. `idleReapMs` is the only configuration field; it is volatile so a changed value applies without restarting the plugin.
