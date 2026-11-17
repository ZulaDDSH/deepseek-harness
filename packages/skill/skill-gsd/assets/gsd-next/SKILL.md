---
name: gsd-next
description: Read the project state and offer the single next GSD step in one question, then load that step's skill. Use when the user runs /gsd-next or asks what to do next in a GSD project.
---

# /gsd-next

Route the user to the next step of the GSD workflow. This skill never does the step itself.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

## Steps

1. Read `.planning/STATE.md` and `.planning/ROADMAP.md`.
   - If `.planning/PROJECT.md` is missing, the next step is /gsd-new-project.
   - If `.planning/.continue-here.md` exists, the next step is /gsd-resume-work.
2. Find the current phase folder and decide the next step from the files in it.
   - No `CONTEXT.md`: /gsd-discuss-phase.
   - `CONTEXT.md` but no plan files: /gsd-plan-phase.
   - Plan files without a SUMMARY for every plan: /gsd-execute-phase.
   - Every plan has a SUMMARY, but `VERIFICATION.md` is missing or not `passed`: /gsd-verify-work, or /gsd-execute-phase when the status is `gaps_found`.
   - Verified but not shipped: /gsd-ship.
   - Shipped, with later phases left: /gsd-discuss-phase for the next phase.
   - All phases shipped: /gsd-audit-milestone.
3. Ask one question with `ask_user_question`.
   - The first option is the next step, with "(Recommended)" in its label.
   - The other options are "Show progress first", which loads /gsd-progress, and "Stop".
4. On the first option, load the matching skill with `skill`, using its exact name, and follow it. On "Show progress first", load /gsd-progress.

## Rules

- Do not change any file.
- Do not start a step that the files do not support, even if the user asks for it. Report the missing input instead.

Adapted from GSD (MIT), see NOTICE-GSD.md
