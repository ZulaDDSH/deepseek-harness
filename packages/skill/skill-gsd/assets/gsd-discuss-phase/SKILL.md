---
name: gsd-discuss-phase
description: Gather the decisions for one roadmap phase through short questions, then write its CONTEXT.md before planning. Use for the discuss step of the GSD phase loop or when the user runs /gsd-discuss-phase.
---

# /gsd-discuss-phase

Capture the choices a phase needs before research and planning, so nothing downstream guesses. Ask only about choices the roadmap leaves open.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults and gate rules are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

Argument: an optional phase number. Without one, use the current phase in `.planning/STATE.md`.

## Steps

1. Load context.
   - Read `.planning/PROJECT.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, and every earlier `.planning/phases/*/CONTEXT.md`.
   - Find the phase entry: its goal, requirement IDs and success criteria.
   - If `PROJECT.md` is missing, stop and tell the user to run /gsd-new-project.
2. Create `.planning/phases/<NN>-<slug>/` if it does not exist.
3. Scout the code.
   - Use `glob` and `grep` to find the modules, components and tests the goal touches.
   - Note reusable code and established patterns, with their paths.
4. Find the gray areas: choices the goal and success criteria leave open, such as data format, error behaviour, placement or API shape.
   - Drop any already decided in an earlier `CONTEXT.md`.
   - Keep two to four.
5. Let the user choose. Ask one `ask_user_question` with `multi_select` set to true.
   - Give each gray area an option, with its tradeoff in the description.
   - Add "Decide for me" as the last option.
6. Deep-dive each chosen area.
   - Ask one to three concrete questions per area in one `ask_user_question` call, with the recommended option first.
   - Stop when the answer settles the area.
   - Record each answer as a locked decision `D-NN`.
   - When the user says to decide, record your default under Claude's discretion.
7. Write `CONTEXT.md` from `templates/CONTEXT.md`: phase boundary, locked decisions, discretion, canonical references, reusable code and deferred ideas.
8. Update `STATE.md`: step is discuss, status is complete, and add a last-activity line.
9. Commit `CONTEXT.md` and `STATE.md` as `docs(<NN>): capture phase context` when `planning` is `commit`. When it is `local`, leave them uncommitted.
10. Keep a `todo_write` list of these steps, with the current one in progress.
11. Gate.
    - Under `auto`, skip steps 5 and 6. Take the recommended option for each gray area, record it under Claude's discretion, and continue.
    - Otherwise, follow the `gates` setting for this step. When it asks, use the gate question in `shared/conventions.md` with "plan" as the next step.

## Rules

- Never ask about a choice the roadmap already settles.
- Every locked decision keeps the user's own wording in `CONTEXT.md`.
- If the user asks to stop, save progress in `STATE.md` and point them to /gsd-pause-work.

Adapted from GSD (MIT), see NOTICE-GSD.md
