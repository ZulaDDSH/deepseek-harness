---
name: gsd-help
description: List the GSD commands, what each one does, the order of the phase loop, the planning files and where the GSD settings live. Use when the user runs /gsd-help or asks how the GSD workflow works.
---

# /gsd-help

Explain the GSD workflow in DSH. Read-only: no files change and no questions are asked.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults are in `shared/settings.md`.

## Reply with this

**The phase loop.** Each roadmap phase goes through discuss, plan, execute, verify and ship.

- Discuss records the decisions.
- Plan writes the plans and checks them.
- Execute runs one coder per plan, with one commit per task.
- Verify tests the behaviour with the user.
- Ship opens a pull request and never merges.

**Core loop:** /gsd-discuss-phase, /gsd-plan-phase, /gsd-execute-phase, /gsd-verify-work, /gsd-ship.

**Progress and state:** /gsd-next (route to the next step), /gsd-progress (report), /gsd-pause-work and /gsd-resume-work (handoff), /gsd-autonomous (run the remaining phases without asking, stopping before any push).

**Small jobs and setup:** /gsd-quick (one small task with a plan file), /gsd-fast (one trivial change), /gsd-new-project (create PROJECT, ROADMAP and STATE), /gsd-map-codebase (map an existing codebase).

**Quality:** /gsd-code-review, /gsd-debug, /gsd-secure-phase, /gsd-ui-review, /gsd-audit-milestone.

**Settings.** Gates (`every-step`, `plan-and-ship` or `auto`), plan author, planning files (commit or local), check rounds and parallel waves. Set them per session in Orchestrator & Subagent Setup, or globally in Settings. Defaults are in `shared/settings.md`.

**Files.** Everything lives in `.planning/`: PROJECT.md, ROADMAP.md, STATE.md, and one folder per phase under `phases/`.

**Credit.** The workflow is adapted from Get Shit Done (MIT). See NOTICE-GSD.md.

Adapted from GSD (MIT), see NOTICE-GSD.md
