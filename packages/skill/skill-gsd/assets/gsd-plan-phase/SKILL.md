---
name: gsd-plan-phase
description: Turn a phase's CONTEXT.md and roadmap goal into PLAN.md files grouped into dependency waves, then check them with a reviewer before execution. Use for the plan step of the GSD phase loop or when the user runs /gsd-plan-phase.
---

# /gsd-plan-phase

Produce executable plans for one phase, each small enough for one coder, and have a reviewer check them before anything runs.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults and gate rules are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`. The planning method is in `briefs/planner.md`, and the checks are in `briefs/plan-checker.md`.

Argument: an optional phase number. Without one, use the current phase in `.planning/STATE.md`.

## Steps

1. Check the inputs.
   - Read `ROADMAP.md` (the phase entry), `CONTEXT.md` and `STATE.md`.
   - If `CONTEXT.md` is missing, ask with `ask_user_question` whether to run /gsd-discuss-phase first or to plan without recorded decisions.
   - If plan files already exist, keep any that have a SUMMARY, and ask before replacing the rest.
2. Research when the phase touches code or APIs the repository does not already use.
   - Spawn one `researcher` child with `briefs/researcher.md` filled in for the question and the phase folder.
   - Otherwise write "Research skipped: existing patterns cover it" in `STATE.md`.
3. Write the plans, following the `planAuthor` setting.
   - `orchestrator`: write each `<NN>-<PP>-PLAN.md` from `templates/PLAN.md`, using the method in `briefs/planner.md`.
   - `researcher`: spawn one `researcher` child with `briefs/planner.md` filled in. When it returns, read every plan it wrote and fix anything the method breaks before the check.
4. Check the plans.
   - Spawn one `reviewer` child with `briefs/plan-checker.md` filled in, whatever `checkRounds` is.
   - On `PLAN CHECK: PASSED`, go to step 5.
   - On issues, revise the plans (for `researcher`, re-run the planner child with the issues appended), then check again. Do this at most `checkRounds` times; with 0, do not revise.
   - Blockers that remain go to the gate, never into execution.
5. Record the plans. Under the roadmap phase, list each plan as `- [ ] <NN>-<PP>: <summary>` and update the plan count. Update `STATE.md`: step is plan, plus a last-activity line.
6. Commit the plans, research, `ROADMAP.md` and `STATE.md` as `docs(<NN>): plan phase` when `planning` is `commit`. When it is `local`, leave them uncommitted.
7. Gate.
   - Under `auto`, continue to execute.
   - Otherwise, follow the `gates` setting for this step. When it asks, list the plan count, the waves, each plan's title and the checker result, including any blockers left.
   - Use the gate question in `shared/conventions.md` with "execute" as the next step. Recommend "Revise plans" when blockers remain.

## Rules

- Every plan needs a non-empty `requirements` list.
- `files_modified` must let the wave rules in `shared/conventions.md` keep each wave disjoint.
- Never start execution while a blocker is open.

Adapted from GSD (MIT), see NOTICE-GSD.md
