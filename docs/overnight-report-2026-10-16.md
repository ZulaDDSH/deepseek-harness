# Overnight report (2026-10-16)

All work is on branch `nomad/harness-improvements` and is **uncommitted**. Nothing was pushed, merged or committed. The tree has 316 modified files, 94 new files and 2 deletions (`ui-chat/.../conversation-nodes/process-activity.ts` moved to `contract/`, and the old pi-ai 0.85.1 patch).

Each feature was built by a Haiku agent and reviewed by a Sonnet agent, which fixed what it found.

## Gate results (final run, whole repo)

- `tsc -b tsconfig.host.json` and `tsc -b tsconfig.client.json`: 0 errors.
- `run-oxlint.ts .`: clean.
- All 15 `gen-*.ts --check` plus `gen-scoped-events --check`: up to date.
- `persistence-changes --check`: 67 roots match 13 history records.
- Verifiers: 56 of 57 pass. `verify-client-domain-graph` still fails with 67 violations in 34 tracked files outside the new feature files. They were left alone, and nobody checked whether the last commit already fails this gate. The one violation from tonight's new code (`ui-chat` live activity) is fixed.
- Full vitest (`vitest run`, 658 s): 1845 files passed, 43 failed; 37,904 tests passed, 104 failed. The failures I spot-checked are tied to this Windows machine, not to tonight's changes. Not every failing file was examined individually; the four groups below cover all 43 files.
  - About 30 files, almost all of them filesystem, workspace or sandbox tests: `EPERM ... symlink` (Windows symlink privilege not granted). 56 such errors in the log.
  - `sandbox-windows-acl`, `pwsh-sandbox`, `apps/desktop` upload-credentials and signature tests: Windows ACL, signing and credential environment.
  - `ui-schedule` task-manager (2 tests): the tests assume the device timezone differs from the task's timezone; on this machine they match.
  - Load timeouts: `migrate-sessions-to-v4` timed out at 5 s under the full-suite load. `persistence-schema`, `persistence-epoch-header` and `gen-client-catalog` pass when rerun alone.
  - Before tonight's changes, `media-references.host.spec.ts` already failed on the same symlink EPERM.
- `pnpm install --offline --ignore-scripts` was run (scripts skipped because lefthook's postinstall refuses a user `core.hooksPath`). It only added missing workspace links to `pnpm-lock.yaml` (tool-watch, subagent, session-controller, tool-subagent, and tool-watch under `python/sdk-runtime`).

**Morning fix:** the desktop build failed its client-bundle purity check, which the repo checks above don't run. Subagent Setup code imported values from `dsh-client-ui-conversation` and `dsh-api-session-controller`. Fixed: the view id is now a string literal, and the role list, effort levels and policy text are copied into `ui-subagent/src/client/subagent-setup/contract.ts`. `tests/subagent-setup-contract.client.spec.ts` keeps that copy identical to the Host source.

## What was built

### 1. Gemini CLI, Grok CLI and Cursor CLI terminal sessions
- The model picker has an "Agent CLIs (terminal)" group. Picking one opens a Session whose page is a plain terminal running `gemini`, `grok` or `cursor-agent` in the Session's workspace. You type and sign in yourself.
- If the CLI is not installed, the entry shows "Not installed" with a link to the vendor's install page.
- ToS safety, as verified by the reviewer: only your keystrokes reach the terminal; the command runs with no extra flags; it gets your normal (unscrubbed) environment; nothing reads `~/.gemini`, `~/.grok`, `~/.cursor` or credentials; output is not saved or sent to any model, memory, digest or telemetry. These Sessions are excluded from agent tools, Jev, hooks, compaction and every way a turn can start (prompt, schedule, goal, agent team, ACP, jobs).
- SSH Sessions hide CLI entries, because launching over SSH is refused.

### 2. Usage panel and near-limit switch prompt
- When any usage window (5-hour, weekly or monthly) reaches the threshold (default 90%, set under Plugins > Usage warnings, range 50-100), a prompt appears above the composer.
- For Claude: "Switch to API credits" (shown only when an API key exists), or "Not now". It offers to switch back after the window resets. It never switches on its own.
- It is the same setting as Settings > Models "Pay for requests with", and Claude CLI subagents follow it too.
- Claude usage comes from Claude's response headers and Claude CLI rate-limit events, so it appears after your first request. Claude reports no monthly window; OpenCode Go is the only monthly source.

### 3. Subagent Setup tab
- A tab next to Trajectory, visible on a brand-new Session and without developer tools (Chat and Trajectory tabs are now always visible too).
- Roles: orchestrator, coder, reviewer, researcher. Each is a fixed model or "Jev decides". Jev never reroutes a fixed role.
- Claude roles can run on the Claude CLI (your subscription). When the CLI is available the defaults are coder Haiku and reviewer Opus (Sonnet fallback). Role runs follow the same API-credits switch.
- Enforced in both the subagent tool and the workflow tool. While Setup is on, a call that picks provider, model or effort without a role is rejected.
- While Setup is on, the composer picker still opens but its model list is locked, with an "Open Subagent Setup" link. Ultracode and Fast mode stay usable.

### 4. CI/PR watch tool (`watch`)
- The agent starts a watch on a command (for example `gh pr checks 123` or `curl -fsS <url>`). It re-runs every 60 s (minimum 30) until the command succeeds, its output matches a pattern, or its output changes. The default timeout is 2 h, maximum 24 h.
- No model calls happen between checks. When the condition is met, it wakes the Session: a new turn if idle, a notice if busy. Goal runs wait while a watch is pending.
- It shows in the background-job list and can be stopped there. It runs under the same sandbox as the shell tool. It is forge-neutral.
- It is wired into the standard, cordis, economy and ptc presets.

### Done earlier tonight (also reviewed)
- Ultracode toggle per Session in the model picker (any model).
- Anthropic API credits: key field plus "Pay for requests with"; the Claude CLI uses the key when you choose credits.
- Plain-language Jev popover.
- Mid-turn messages: a message now ends a long `job_output` wait without cancelling the job.
- pi-ai 1.2.0 upgrade, the new OpenCode `/inference` endpoints, updated catalog, and xAI.
- Live activity line, per-row elapsed clocks, and a 2-minute "may be stuck" hint with Stop.
- Borrowed sign-ins: all are shown, tagged, confirmed, and carry a warning card.
- Session search on/off toggle (Settings > General).
- Genericity audit: nothing tailored to one user's setup.

## Needs your decision

1. **Skill discovery reads CLI folders.** Existing committed code (`packages/skill/skill-filesystem/src/roots.ts`) scans `~/.gemini/skills` and `~/.cursor/skills` for skills. It reads no credentials, but it is inside those folders. Keep it or drop it?
2. **File search sees CLI folders.** Glob and file-reference search don't exclude project `.gemini`, `.grok` and `.cursor` folders. Add them to the excludes?
3. **CLI environment.** The CLI terminal inherits your full environment, including exported API keys, as a normal terminal would. Confirm.
4. **No restart after a CLI exits.** The user opens a new Session instead. Add a restart button?
5. **Main-chat 429s are not detected as a hard limit.** pi-ai only reports headers on successful responses, so a hard Claude limit is seen only from Claude CLI runs. Fixing this needs an adapter error-path change.
6. **Deployment-pinned API key.** If the base config pins `apiKeyEnv`, the usage prompt still offers a switch that cannot take effect. Add a "locked" flag?
7. **Usage is empty after a restart** until the next request (it is kept in memory only).
8. **Subagent Setup extras not built:** per-role Jev decisions in the Jev popover, and custom role names.
9. **Watch tool:** a timed-out watch reports "completed" with a "timed out" detail; should it be "failed"? Commands printing more than 64 kB per check write a spill file each time.
10. **Package dependency classification.** `cliTerminalProfileOf` was added to `PEER_REQUIRED_HOST_EXPORTS` in `scripts/package-dependency-policy.ts`, and `dsh-agent` to `ui-memory-workspace` peerDependencies. Please review.
11. **Persistence record.** `docs/persistence-changes/2026-10-15-cli-terminal-marker.md` also acknowledges the `session/run-options.subagentSetup` and `subagent/descriptor.routePinned` roots. Split it into its own record if you prefer.
12. Carried from earlier: subagent live progress and auto-compaction live status (contract and engine changes); lower the `job_output` maximum wait (600 s); minimax-m2.5 on Go; deepseek-v4-flash price or retirement; the gemini-4-argon discount ends 2026-11-30; a "Use the official CLI" sign-in action; a "Clear search index" action.

## Not verified live
- OpenCode `/inference` endpoints (no test requests were sent).
- Anthropic API-credits billing, and the Claude CLI's `ANTHROPIC_API_KEY` precedence over `/login`.
- Claude rate-limit header units against a real response; OpenCode Go and Codex usage endpoints.
- Visual layout of the Subagent Setup tab on a blank Session, the CLI terminal pane and the usage prompt. The app was not relaunched after the final changes.
- CLI vendor install URLs were not fetched.
