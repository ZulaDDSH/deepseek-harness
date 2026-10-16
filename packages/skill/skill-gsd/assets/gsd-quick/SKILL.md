---
name: gsd-quick
description: Do one small, well-defined change with GSD guarantees (a short written task, one coder child, one verified commit, a state log) without the phase machinery. Use when the user runs /gsd-quick or asks for a small change that does not need a phase.
---

# /gsd-quick

A small change with a written task, a verify command, one coder and one commit. No phase, no waves and no reviewer pass.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

Argument: the task description, which is the rest of the message.

## Steps

1. Restate the task in one sentence. Check that it touches one or two files and needs no new decision.
   - If it is bigger, ask with `ask_user_question` whether to use /gsd-plan-phase, or to do it as a quick task anyway.
2. Write `.planning/quick/<slug>.md`: the task, the files expected to change, the verify command and the done check.
3. If the subagent tool cannot run a `coder` child, stop and tell the user to set a coder route in Orchestrator & Subagent Setup. Do not edit the code yourself.
4. Run one `coder` child in the foreground, with `role` `coder`.
   - Its prompt is `briefs/executor.md` with `plan_path` set to the quick file.
   - Set `phase_dir` to `.planning/quick`, `summary_path` to `.planning/quick/<slug>-result.md`, and `planning` to the setting in your instructions.
   - Add to the prompt that the quick file is a single-task plan with no `CONTEXT.md`, and that the commit message is `type(quick-<slug>): summary`.
   - The coder commits as `fix(quick-<slug>)` or `feat(quick-<slug>)`.
5. Run the verify command with `bash`. If it fails, run the coder once more with the failure in its prompt. Stop after two attempts and report.
6. Log the task in `STATE.md` under a `Quick tasks` heading, creating it if needed: `- <date> <slug>: <summary> (<commit hash>)`.
   - Commit `STATE.md` as `docs(quick-<slug>): log quick task` when `planning` is `commit`.
   - When it is `local`, leave it uncommitted.
7. Report the commit, the verify result and the files changed.

## Rules

- No gate. A quick task asks only when its size is in doubt.
- Keep the written task to what the user asked. Anything else becomes a follow-up note.

Adapted from GSD (MIT), see NOTICE-GSD.md
