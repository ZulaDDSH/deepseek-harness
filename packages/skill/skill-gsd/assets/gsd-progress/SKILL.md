---
name: gsd-progress
description: Summarise a GSD project's progress, including the current phase and step, plans done, verification status, blockers and the next command. Read-only. Use when the user runs /gsd-progress or asks where the project stands.
---

# /gsd-progress

Report where the project stands, without changing any file.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

## Steps

1. Read `.planning/PROJECT.md`, `.planning/ROADMAP.md` and `.planning/STATE.md`.
   - If `PROJECT.md` is missing, say the project is not started, point to /gsd-new-project, and stop.
2. For each phase in `ROADMAP.md`, read its folder under `.planning/phases/` and collect:
   - plans done (SUMMARY count) out of plans written
   - the `status` line of `VERIFICATION.md` and of `UAT.md`, if present
   - whether a review, security or UI review exists, and any blocker it lists
3. Reply with a short report.
   - Current position: phase, step and plan, plus the last activity line from `STATE.md`.
   - A table of phases: name, plans done, verification, shipped.
   - Blockers, open todos and any paused work (`.continue-here.md`).
   - The next command to run, and why.

## Rules

- Do not change files and do not ask questions.
- If `STATE.md` disagrees with the folders, report the difference and trust the folders.

Adapted from GSD (MIT), see NOTICE-GSD.md
