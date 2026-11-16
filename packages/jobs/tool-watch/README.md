---
description: "The watch tool for waiting on an external condition: a host-side poll re-runs one shell command until it fires, times out, or keeps failing, then wakes the owning agent."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-watch

## Summary

Use `dsh-tool-watch` to let an agent wait for a condition it cannot see directly, such as CI finishing, a pull request merging, a deploy completing, or a service becoming reachable. The `watch` tool re-runs one shell command at a fixed interval on the host, with no model call between checks, under the session's sandbox policy. When the condition holds, the timeout passes, or checks keep failing, the owning agent wakes: an idle agent starts a turn, and a busy agent receives the notice at its next step. Watches last only while the host process runs.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load this plugin where the shell tool and the job registry are composed. It requires the `ctx.shell`, `ctx.shellEnv`, `ctx.jobs`, `ctx.systemPrompt`, and `ctx.tools` services. When the mounted shell executor confines commands, `ctx.sandboxPolicy` must also be mounted; the plugin refuses to load otherwise, so a watch never runs outside the policy that governs the shell.

The `watch` tool takes:

- `command` — the shell command re-run at every check. Its exit code and stdout are what `until` reads.
- `label` — a short name shown in job lists and in the wake-up notice.
- `until` — exactly one of `exit_code`, `regex`, or `changed`. A regex that takes longer than 250 ms on one check's output counts as a failed check, so a pattern with catastrophic backtracking ends the watch as `failed` instead of stalling the host.
- `interval_s` — seconds from the end of one check to the start of the next, no longer than the timeout.
- `timeout_min` — minutes before the watch settles without its condition.

Configuration sets the interval floor and default, the timeout default and cap, and the number of consecutive failed checks that end a watch as `failed`.

Each watch is an ordinary background job. `job_list` shows it with its live progress line, `job_output` returns its outcome once it settles, and `job_kill` stops it.

<a id="understand-the-implementation"></a>
## Understand the implementation

Each watch is one job of kind `watch`, started through `ctx.jobs.start` and owned by the calling agent. The job's producer runs the check loop. Settlement is the only wake: this package delivers no notice itself, so the completion delivery of `@deepseek-ai/dsh-tool-jobs` chooses between a follow-up turn and a next-step injection. The goal driver in `@deepseek-ai/dsh-goal-round-driver` does not start a round while the owner has a running watch.

**Runtime invariant:** No companion is published because the package keeps no state outside the job registry; each watch's progress lives in its job.

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains this guidance, which points the model at `watch` instead of sleep or polling loops.

##### Watch guidance

```markdown
To wait for an external condition, start a watch instead of sleeping or polling yourself, then end your turn: the watch wakes you when it fires, times out, or fails.
```

#### Token effect

Small fixed input cost per request while the plugin is loaded.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged.

### Tool schemas

#### What the model sees

The generated [`watch` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-watch) while the tool is visible.

#### Token effect

Fixed schema cost on each request where the tool is visible.

#### KV Cache effect

Changes only when the tool set or its description changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when watches are a poor fit. They are current package constraints, not a task backlog.

- **Watches last only while the host process runs.** Nothing is persisted, so a restart drops every pending watch without a notice.
- **A kill from the client still wakes an idle owner.** Only a kill the model itself requests suppresses the notice; a client kill settles as a normal notice.
- **Hook matchers do not see watch checks.** A PreToolUse hook matched by a shell tool name does not run for each check, because checks do not pass through the tool-call path.
- **Progress lines and the wake-up notice are English.** The job-list progress text is not localised.
- **Watches share the owner's background-job limit** with bash and subagent jobs.
- **A watch that settles into an idle owner with a spent wake budget waits for the next user input.** The goal driver is not re-driven by a watch settlement, so a goal paused on that watch resumes at the next turn boundary.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

- The design decisions (abort reasons, the consecutive-failure rule, the goal gate placement, and the sandbox refusal) are recorded in [the code notes](../../../docs/code-notes/deepseek-harness.md#watch-tool-and-goal-waits), anchored to `poll.ts` and `index.ts` symbols.
- The check loop is tested through a scripted shell in `tests/tool-watch.spec.ts`; the pending-watch goal gate is tested in `packages/goal/goal-round-driver/tests/goal-watch-wait.spec.ts`.
- After changing the `watch` parameters, `DESCRIPTION`, or `Config`, run `pnpm run gen-tool-catalog` and `pnpm run gen-config-catalog` so the generated catalogs stay current.

</details>
