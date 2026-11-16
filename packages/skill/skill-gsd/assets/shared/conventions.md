# GSD conventions for DSH

Paths such as `templates/STATE.md`, `briefs/executor.md` and `shared/settings.md` are relative to this skill's base directory. Read the settings file first, then the templates and briefs a step names.

## Roles

- Orchestrator (you): the only role that talks to the user and calls `ask_user_question`. Children cannot ask. You write `.planning/` state (`PROJECT.md`, `ROADMAP.md`, `STATE.md`, and phase files you own). You do not write product code.
- `coder`: changes code and commits. Writes one `<NN>-<PP>-SUMMARY.md` per plan.
- `reviewer`: reads, runs checks, and writes only `VERIFICATION.md`, `REVIEW.md`, `SECURITY.md`, `UI-REVIEW.md` or `MILESTONE-AUDIT.md`. Never edits product code.
- `researcher`: reads and writes `RESEARCH.md` or a codebase map. Never edits product code.
- Brief files are prompts. Fill the `{placeholders}`, replace each relative asset path in the text (`templates/...`, `briefs/...`, `shared/...`) with its absolute path under this skill's base directory, because a child cannot resolve it, and pass the result as the `prompt` of a `subagent` call.

## Tools

- `ask_user_question`: `questions` of `{id, question, header, options, multi_select}`. Options are `{label, description}`. Put the recommended option first and append "(Recommended)" to its label.
- `todo_write`: sends the complete list each time. Mirror the current step's checklist; keep one item `in_progress`.
- `read`, `write`, `edit`, `grep`, `glob`: files. `bash`: git, the test runner, and `gh`.
- `subagent`: `description` (3 to 5 words), `prompt`, `role` (`coder`, `reviewer` or `researcher`). Run independent children together in one message with `run_in_background: true`, then collect each with `job_output`.
- `skill`: load another `gsd-*` skill by its exact name.

## Files in `.planning/`

```
PROJECT.md  ROADMAP.md  STATE.md  .continue-here.md
codebase/                         (map-codebase)
debug/<slug>.md                   (debug)
quick/<slug>.md, quick/<slug>-result.md   (quick)
phases/<NN>-<slug>/
  CONTEXT.md  RESEARCH.md  <NN>-<PP>-PLAN.md  <NN>-<PP>-SUMMARY.md
  VERIFICATION.md  UAT.md  REVIEW.md  SECURITY.md  UI-REVIEW.md
MILESTONE-AUDIT.md                (audit-milestone)
```

`NN` is the zero-padded phase number, `PP` the zero-padded plan number, and `slug` a lowercase hyphenated name.

## Planning files

- `planning: commit`: `.planning/` is a normal part of the repository, committed with the work.
- `planning: local`: ensure `.planning/` is listed in the file printed by `git rev-parse --git-path info/exclude`, and append it there if not. This keeps it out of every commit without touching `.gitignore`. If `.planning/` is already tracked, tell the user, and neither untrack nor delete it.

## Commits

- One commit per task: `type(NN-PP): summary`, where type is `feat`, `fix`, `refactor`, `test`, `docs` or `chore`. Planning-only commits use `docs(NN): summary`.
- Stage explicit paths with `git add <path>`. Never use `git add -A` or `git add .`.
- Commit with the user's configured git identity. Add no trailers (no `Co-Authored-By`, no "Generated with" lines) and no `--author`. Do not pass `--no-verify`.
- With `planning: local`, never stage `.planning/`.

## Waves

- A plan's `wave` is one more than the highest wave among its `depends_on` plans.
- Plans in one wave must not share a path in `files_modified`. If they do, run them one after another.
- With `parallelWaves: false`, run one plan at a time, in plan order.

## Gate question

Use this shape at every gate the settings require:

- header: `Next step`
- question: `<Step> is complete: <one-line result>. What next?`
- options: `Continue to <next step> (Recommended)`, `Revise <step>`, `Run the rest automatically`
