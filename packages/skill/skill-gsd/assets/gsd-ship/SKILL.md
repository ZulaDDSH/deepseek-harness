---
name: gsd-ship
description: Check that a phase is verified, push its feature branch, open a pull request with the repository's own tooling, run a reviewer pass on the diff, and stop. Never merges. Use for the ship step of the GSD phase loop or when the user runs /gsd-ship.
---

# /gsd-ship

Take a verified phase to an open pull request. Shipping leaves the machine, so this skill always asks before it pushes or creates a pull request. It never merges.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults and gate rules are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

Argument: an optional phase number. Without one, use the current phase in `.planning/STATE.md`.

## Steps

1. Preflight. Stop unless all of these hold.
   - `VERIFICATION.md` status is `passed`. For `human_needed`, finish the UAT first. For `gaps_found`, go back to /gsd-execute-phase.
   - `UAT.md` is `complete` with no open issue.
   - Every plan has a SUMMARY.
   - `git status --short` shows no uncommitted product changes, checked with `bash`.
2. Branch. Run `git branch --show-current`. If the branch is the default branch (`main` or `master`), stop and tell the user to switch to a feature branch. Do not switch branches yourself.
3. Tooling. Read `AGENTS.md`, `CONTRIBUTING.md` or any pull request template to find how this repository opens pull requests, and use that tool. If none is named, use `gh pr create`. Check its login with `bash` first. If it is not available, stop and report.
4. Draft the title and body. The body covers the phase goal, the changes listed in the SUMMARY files, the verification result and the test commands run. Write it to a file outside the repository, using `mktemp`, and delete that file afterwards. The title and body carry no AI attribution: no "Generated with" line and no `Co-Authored-By`.
5. Ask before pushing. Use `ask_user_question` with the question "Push <branch> and open a pull request titled '<title>'?" and the options "Push and open the pull request (Recommended)", "Edit the title or body first" and "Stop".
6. On approval, push with `git push -u origin <branch>`, then create the pull request with the tool from step 3. Report the URL.
7. Review. Spawn one `reviewer` child, read-only, to review `git diff <base>...HEAD`. It reports bugs and risks as `file:line` findings with a severity. Show the findings, then ask with `ask_user_question` whether to address them: "Fix them with a coder (Recommended)" or "Leave the pull request as it is". To fix, run a `coder` child on the findings, one commit per fix. Any further push asks again, as in step 5.
8. Record. Set `STATE.md` to shipped and add the pull request URL. When `planning` is `commit`, commit that change as `docs(<NN>): record shipped phase`, and ask before pushing it, as in step 5. When it is `local`, leave it uncommitted.
9. Stop. Never run `gh pr merge`, `git merge` or any other merge. Tell the user that merging is their step.

## Gate

- Under `every-step` and `plan-and-ship`, this skill is where the phase is confirmed before it leaves the machine.
- Under `auto`, the `gates` setting does not skip the question in step 5. Nothing is pushed or opened without that answer.

Adapted from GSD (MIT), see NOTICE-GSD.md
