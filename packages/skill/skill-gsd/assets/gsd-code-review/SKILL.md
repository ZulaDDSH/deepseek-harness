---
name: gsd-code-review
description: Review the source files one phase changed for bugs, security problems and quality issues, using reviewer children, then write REVIEW.md and offer fixes. Use when the user runs /gsd-code-review for a phase.
---

# /gsd-code-review

Find bugs, security problems and quality issues in the code a phase changed, and record each one with evidence.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

Arguments: a phase number (default: current phase), and optionally a depth: `quick`, `standard` (default) or `deep`.

## Steps

1. Collect the scope.
   - Read the phase's plans and SUMMARY files.
   - Run `git log --name-only` over the phase's commits with `bash`.
   - Keep source files only. Drop `.planning/` files, lockfiles and generated output.
   - If nothing remains, say so and stop.
2. Set the depth.
   - `quick` reviews the diff for bugs only.
   - `standard` checks bugs, security and quality.
   - `deep` also reads the callers and tests of each changed function.
3. Split the files into at most three groups by directory. Spawn one `reviewer` child per group in one message, with `run_in_background` set to true.
   - Each prompt lists its files, the depth, and this output format, one finding per line: `FINDING <blocker|major|minor> <file>:<line> <problem> | evidence: <what you read> | fix: <smallest change>`.
   - Reviewers do not edit files.
4. Collect the replies with `job_output`. Merge duplicates. Keep the evidence and the file and line for each finding.
5. Write `phases/<NN>-<slug>/REVIEW.md`: a summary count by severity, then the findings grouped by severity, each with its evidence and fix.
6. Commit `REVIEW.md` as `docs(<NN>): add code review` when `planning` is `commit`. When it is `local`, leave it uncommitted.
7. If there are blocker or major findings, ask with `ask_user_question`: "Fix the <n> blocker and major findings?" Options: "Fix them with a coder (Recommended)" and "Leave them for later".
   - To fix, run `coder` children, one per group of findings that share no file. Run overlapping groups one after the other.
   - Commit each fix as `fix(<NN>-review): <summary>`.
   - Run the review once more on the changed files, and record the result in `REVIEW.md`.

## Rules

- Reviewers report evidence, not guesses. A finding without a file and line is dropped.
- One fix round only. Anything left goes into `REVIEW.md` as open.

Adapted from GSD (MIT), see NOTICE-GSD.md
