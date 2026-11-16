---
name: gsd-autonomous
description: Run every remaining phase of the roadmap through discuss, plan, execute and verify without asking, stopping only on failure, blocked verification, or before any push, pull request or merge. Use when the user runs /gsd-autonomous or asks GSD to carry the project forward unattended.
---

# /gsd-autonomous

Carry the roadmap forward without questions. This run is in `auto` mode for every phase it touches. The `gates` setting is overridden for this run only. The other GSD settings are unchanged.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults and what `auto` stops on are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

Arguments, in plain words: `from N` starts at a phase, `to N` ends at one, and `only N` runs one phase.

## Steps

1. Read `.planning/ROADMAP.md` and `.planning/STATE.md`. List the phases that are not yet shipped and that fit the arguments. If none remain, report that and stop.
2. Track the run with `todo_write`, with one item per phase.
3. For each phase in order, follow these skills in `auto` mode.
   - /gsd-discuss-phase: record the recommended choice for each gray area as discretion, and ask nothing.
   - /gsd-plan-phase: follow it with no gate. Its plan check still runs up to `checkRounds`.
   - /gsd-execute-phase: follow it with no gate.
   - Verification: run the reviewer check from /gsd-execute-phase step 6 and read `VERIFICATION.md`. Do not run the user acceptance conversation, because /gsd-verify-work step 2 applies.
4. Stop when any of these happens. Write the reason into `STATE.md` with the resume command, and end the turn without asking.
   - A plan reports `BLOCKED`, or a child stops at a checkpoint that needs a person.
   - Gaps remain after `checkRounds` fix rounds.
   - Verification is `human_needed`, or a check fails and cannot be fixed.
   - The next step would push, open a pull request or merge.
5. Do not run /gsd-ship. Shipping always asks, and a run in `auto` mode never asks. When every phase in range is verified, stop and report it, naming each phase that is ready for /gsd-ship.
6. Finish with a report: phases completed, plans and commits, the verification status of each phase, and the stop reason if the run stopped early.

## Rules

- Never skip a failed step to reach the end of the roadmap.
- Each phase's commits follow the same rules as the phase skills, so the run leaves a reviewable history.

Adapted from GSD (MIT), see NOTICE-GSD.md
