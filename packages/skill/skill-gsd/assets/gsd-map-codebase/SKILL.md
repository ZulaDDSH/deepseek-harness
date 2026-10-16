---
name: gsd-map-codebase
description: Map an existing codebase into .planning/codebase/ with parallel researcher children covering stack, architecture, quality and concerns, without changing product code. Use when the user runs /gsd-map-codebase or starts GSD work on code that was not written with GSD.
---

# /gsd-map-codebase

Write a short, verified map of the repository that later GSD steps can read. Product code is not changed.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`. The researcher rules are in `briefs/researcher.md`.

Argument: optional focus words, such as `stack` or `concerns`. With none, map all four areas.

## Steps

1. Check `.planning/codebase/`. If it exists, ask with `ask_user_question` whether to refresh all of it, refresh only the requested focus, or stop.
2. Spawn one `researcher` child per focus in a single message, with `run_in_background` set to true.
   - Each prompt is `briefs/researcher.md` filled in with the focus, and `codebase_dir` set to `.planning/codebase`.
   - Collect each with `job_output`.
3. Check that each focus wrote its files: `STACK.md`, `INTEGRATIONS.md`, `ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `TESTING.md` and `CONCERNS.md`. Re-run a focus once if its files are missing.
4. Scan the written documents for secrets with `grep`. Look for names such as `api_key`, `password` or `token` followed by a value, and for private-key headers. Remove any value found, and keep only its location.
5. When `planning` is `commit`, commit the folder as `docs: map codebase`. When it is `local`, leave it uncommitted.
6. Report the files written and the top three concerns, each with its file.
   - If the project has no `PROJECT.md`, suggest /gsd-new-project next.

## Rules

- Do not change product code.
- No gate.

Adapted from GSD (MIT), see NOTICE-GSD.md
