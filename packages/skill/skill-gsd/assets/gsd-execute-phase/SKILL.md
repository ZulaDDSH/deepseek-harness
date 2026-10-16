---
name: gsd-execute-phase
description: Execute a phase's planned work as coder children, wave by wave with one commit per task, then have a reviewer check the phase goal and loop fixes. Use for the execute step of the GSD phase loop or when the user runs /gsd-execute-phase.
---

# /gsd-execute-phase

Run the plans of one phase. Each plan goes to a `coder` child. Plans in a wave run in parallel only when the `parallelWaves` setting allows it. A `reviewer` child then checks the phase goal.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults and gate rules are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`. The coder rules are in `briefs/executor.md`, and the goal check is in `briefs/verifier.md`.

Argument: an optional phase number. Without one, use the current phase in `.planning/STATE.md`.

## Steps

1. Load the plans.
   - List `.planning/phases/<NN>-<slug>/<NN>-*-PLAN.md`.
   - Skip any plan that already has a `<NN>-<PP>-SUMMARY.md`.
   - Read each remaining plan's `wave`, `depends_on` and `files_modified`.
   - If none remain, go to step 6.
2. Group the plans by wave, lowest first. Inside a wave, if two plans share a path in `files_modified`, run them one after the other.
3. Check the working tree with `git status --short` using `bash`.
   - If files a plan will change already have uncommitted edits, ask with `ask_user_question` whether to stop or to continue with those edits left as they are.
   - Never stash, reset or discard edits yourself.
4. Run each wave.
   - When `parallelWaves` is true and the wave has more than one plan, send one message with one `subagent` call per plan. Use `role` `coder` and `run_in_background` true. Each prompt is `briefs/executor.md` filled in with the plan path, the phase folder, the summary path and the `planning` value. Collect each with `job_output` until all finish.
   - Otherwise run the plans one at a time, with `role` `coder` and `run_in_background` false.
   - Read each reply's first line.
     - `DONE`: confirm the SUMMARY exists and `git log --oneline` shows one commit per task.
     - `CHECKPOINT`: ask the user the question it names with `ask_user_question`, then run the plan again with the answer added to the brief. This stops for a person in every mode.
     - `BLOCKED`: stop the phase and report the reason. Ask how to proceed, or under `auto` report and end the turn without asking.
5. Record progress after each wave. Tick the finished plans in `ROADMAP.md` and update `STATE.md`.
6. Check the phase goal.
   - Spawn one `reviewer` child with `briefs/verifier.md` filled in, using the roadmap entry and the files the SUMMARY files list as changed.
   - Read the `status` line of `VERIFICATION.md`.
   - `passed`: go to step 7.
   - `gaps_found`: write one fix plan per gap from `templates/PLAN.md`, numbered after the existing plans. Run them with step 4, then verify again. Stop after `checkRounds` fix rounds and report the gaps that remain.
   - `human_needed`: go to step 7. Under `auto`, stop and report instead, because verification is blocked.
7. Commit the state changes as `docs(<NN>): complete execution` when `planning` is `commit`, staging only `.planning/` files. When it is `local`, leave them uncommitted.
8. Gate. Follow the `gates` setting.
   - Under `auto` or `plan-and-ship`, continue to verify without asking.
   - Under `every-step`, ask with the gate question in `shared/conventions.md`, with "verify" as the next step.
   - Report the plan count, the commit count and the verification status.

## Rules

- Mark a plan done only when its SUMMARY exists and its commits are in `git log`.
- Only this skill's orchestrator edits `ROADMAP.md` and `STATE.md`. Coders never do.

Adapted from GSD (MIT), see NOTICE-GSD.md
