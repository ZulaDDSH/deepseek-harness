---
name: gsd-verify-work
description: Run user acceptance testing for a built phase, one behaviour at a time, record failures in UAT.md, and turn them into fix plans. Use for the verify step of the GSD phase loop or when the user runs /gsd-verify-work.
---

# /gsd-verify-work

Confirm that what was built behaves as the user expects. One test at a time, plain questions, no lecture. Failures become gaps with fix plans.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults and gate rules are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

Argument: an optional phase number. Without one, use the current phase in `.planning/STATE.md`.

## Steps

1. Read `VERIFICATION.md` for the phase.
   - If it is missing, run the reviewer check from `gsd-execute-phase` step 6 first.
   - If its status is `gaps_found`, stop and send the user back to /gsd-execute-phase with the gaps listed.
2. Under `auto`, there is no user conversation. Use `VERIFICATION.md` alone.
   - If its status is `human_needed`, stop and report the human items, because verification is blocked.
   - If it is `passed`, record it in `STATE.md` and go to step 8.
3. Otherwise, create `phases/<NN>-<slug>/UAT.md` from `templates/UAT.md`. Write one test per user-visible behaviour, taken from the SUMMARY files and the locked decisions in `CONTEXT.md`. Do not write one test per file.
4. Ask one test at a time with `ask_user_question`. Put the expected behaviour in the question, and offer "Pass" and "Issue" as options. When the user picks "Issue", their own words arrive in the custom answer; keep them as written.
5. For each issue, record the user's words in `UAT.md`. Then diagnose it with `grep` and `read`, finding the file and line that would cause the symptom. Do not edit code during verification.
6. When all tests are answered, update the summary counts and set the status to `complete`.
7. If there are issues, write one fix plan per issue from `templates/PLAN.md`, numbered after the existing plans, and link each plan in its gap entry.
   - Ask with `ask_user_question` whether to run the fix plans now. If yes, follow `gsd-execute-phase` steps 2 to 6.
   - Re-verify after the fixes, and stop after `checkRounds` rounds.
8. Commit `UAT.md`, the fix plans and `STATE.md` as `docs(<NN>): verify phase` when `planning` is `commit`. When it is `local`, leave them uncommitted.
9. Gate.
   - Under `auto` or `plan-and-ship`, continue to ship, which still asks before any push.
   - Under `every-step`, ask with the gate question in `shared/conventions.md`, with "ship" as the next step.
   - Report the passed, issue and pending counts.

## Rules

- Do not mark a phase verified while any test is pending or any issue is open.
- The `gates` setting decides only whether step 9 asks. The tests in step 4 always need the user.

Adapted from GSD (MIT), see NOTICE-GSD.md
