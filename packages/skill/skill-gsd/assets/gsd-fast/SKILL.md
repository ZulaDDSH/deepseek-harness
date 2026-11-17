---
name: gsd-fast
description: Make one trivial change, such as a typo, a rename or a config value, with a single coder child and one commit, without any planning files. Use when the user runs /gsd-fast for a tiny task.
---

# /gsd-fast

The lightest path in GSD: one trivial change, one coder and one commit. No planning files and no state changes.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

Argument: the task description, which is the rest of the message.

## Steps

1. Confirm the task is trivial: one file, a change of about twenty lines or fewer, and no decision for the user.
   - If it is not, say so and suggest /gsd-quick.
2. If the subagent tool cannot run a `coder` child, stop and tell the user to set a coder route in Orchestrator & Subagent Setup.
3. Run one `coder` child in the foreground, with `role` `coder`. Its prompt states the task, the file, the verify command and the commit message `type(fast): summary`. It follows the commit rules in `shared/conventions.md`.
4. Check with `bash` that `git log -1 --oneline` shows the new commit and that the verify command passes.
5. Report the commit hash and the result in one short message.

## Rules

- Write no planning files and change no state.
- Ask no question.

Adapted from GSD (MIT), see NOTICE-GSD.md
