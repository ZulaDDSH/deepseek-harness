---
name: gsd-new-project
description: Start a GSD project by asking focused questions, then write PROJECT.md, ROADMAP.md and STATE.md with requirements and phases. Use when the user runs /gsd-new-project or the project has no .planning/PROJECT.md yet.
---

# /gsd-new-project

Turn an idea into the three planning files every other GSD step reads. Ask only what those files need.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults and gate rules are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

## Steps

1. Check the start state.
   - If `.planning/PROJECT.md` exists, stop and suggest /gsd-progress.
   - If the repository already has code, scout it with `glob` and `grep`, so the questions name the real stack.
2. Ask in batches of up to three questions per `ask_user_question` call.
   - What is being built, for whom, and the one thing that must work (the core value).
   - Constraints: stack, compatibility, deadlines and budget.
   - What is out of scope for the first version.
   - The must-have behaviours, in the user's words.
   - For existing code, what must be kept.
   - Ask a follow-up only where an answer is vague.
3. Write `.planning/PROJECT.md` from `templates/PROJECT.md`. Turn each must-have into a requirement with an ID such as `REQ-01` and one testable sentence.
4. Propose three to seven phases. Each phase has a goal, the requirement IDs it covers, and observable success criteria. Every requirement must sit in at least one phase. Write `.planning/ROADMAP.md` from `templates/ROADMAP.md`.
5. Write `.planning/STATE.md` from `templates/STATE.md`, with phase 01 at the discuss step.
6. Apply the `planning` setting.
   - When it is `local`, add `.planning/` to the repository's `info/exclude` file as `shared/conventions.md` describes, and never stage it.
   - Then ask with `ask_user_question`: "Are PROJECT.md and ROADMAP.md right?" Options: "Looks right (Recommended)", "Revise the roadmap" and "Revise the project".
   - Under `auto`, record the files and continue without asking.
7. When `planning` is `commit`, commit the three files as `docs: initialize GSD project`.
8. Report the files written, and name /gsd-discuss-phase as the next step for phase 01.

## Gate

- Step 6 is the approval gate for this skill. Under `every-step` and `plan-and-ship` it asks. Under `auto` it does not, because the `gates` setting says so.

Adapted from GSD (MIT), see NOTICE-GSD.md
