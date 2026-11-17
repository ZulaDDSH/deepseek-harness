---
name: gsd-resume-work
description: Restore GSD context from .planning/.continue-here.md and STATE.md, compare them with the working tree, and confirm the next action before continuing. Use when the user runs /gsd-resume-work or returns to a paused GSD project.
---

# /gsd-resume-work

Pick up exactly where the last session stopped, after checking that the repository still matches the handoff note.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

## Steps

1. Read `.planning/.continue-here.md` and `.planning/STATE.md`. If the note is missing, stop and suggest /gsd-progress.
2. Compare the note with the repository. Run `git status --short` and `git log -1 --oneline` with `bash`, and report any difference from the note: new commits, or extra or missing edits.
3. Ask with `ask_user_question`: "Resume at: <next action from the note>?" Options: "Resume (Recommended)", "Show progress first" and "Stop".
4. On "Resume", load the skill for the step in the note with `skill`, using its exact name, and follow it from the first next action. On "Show progress first", load /gsd-progress.
5. Once the step is running again, delete `.planning/.continue-here.md`. When `planning` is `commit`, commit the removal as `docs(<NN>): resume work`, staging only that path.

## Rules

- Do not resume a step the note does not name.
- If the repository differs from the note, the user decides before anything continues.

Adapted from GSD (MIT), see NOTICE-GSD.md
