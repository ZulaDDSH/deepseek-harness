---
name: gsd-pause-work
description: Save where GSD work stands into .planning/.continue-here.md so a later session can resume it without rework. Use when the user wants to stop in the middle of a phase or says they will continue later.
---

# /gsd-pause-work

Write a handoff note for the current position. Nothing is discarded and no edits are stashed.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

## Steps

1. Read `.planning/STATE.md` for the current phase, step and plan.
2. Collect the working state with `bash`: `git status --short` and `git log -1 --oneline`.
3. Write `.planning/.continue-here.md` from `templates/CONTINUE-HERE.md`.
   - Fill in the position, the working tree, and any decision the user was weighing.
   - Write the first concrete next action, and the GSD settings in effect.
4. Update `STATE.md`: under session continuity, record where the work stopped and the resume command, /gsd-resume-work.
5. Commit `.continue-here.md` and `STATE.md` as `docs(<NN>): pause work` when `planning` is `commit`. When it is `local`, leave them uncommitted.
6. Tell the user the note is saved, list the uncommitted files, and name /gsd-resume-work as the way back in.

## Rules

- Ask no question. Pausing is one step with no gate.
- Do not stash, discard or reset any edit.

Adapted from GSD (MIT), see NOTICE-GSD.md
