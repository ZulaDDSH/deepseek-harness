---
name: gsd-secure-phase
description: Check a completed phase's changed code against threat categories with reviewer children, and write SECURITY.md with evidence for each mitigation. Use when the user runs /gsd-secure-phase for a phase.
---

# /gsd-secure-phase

Check whether the security threats a phase brings are mitigated in the code, and record the evidence.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

Argument: a phase number (default: current phase).

## Steps

1. Collect the changed source files for the phase, as /gsd-code-review step 1 does.
2. List the threats the phase could bring. Use these categories, and keep only the ones the changed code touches.
   - Input validation.
   - Authentication and authorization.
   - Secrets handling.
   - Injection: shell, SQL, template and path.
   - File access.
   - Unsafe deserialisation.
   - Sensitive data in logs.
   - Network exposure.
   - Dependency risk.
3. Spawn up to three `reviewer` children in one message, with `run_in_background` set to true. Give each a group of categories and the file list.
   - For each category, each child reports one line: `THREAT <category> | status: mitigated|partial|missing | evidence: <file:line> | covered by: <test or check, or none>`.
   - Reviewers do not edit files.
4. Collect the replies with `job_output`. Write `phases/<NN>-<slug>/SECURITY.md`: a table of threat, category, status and evidence, then the open items, each with a suggested fix for every `partial` or `missing` status.
5. If there are open items, ask with `ask_user_question`: "Fix the <n> open items?" Options: "Fix them with a coder (Recommended)", "Accept the risk with a reason I will give" and "Stop". For accepted risks, record the user's reason in `SECURITY.md`.
6. Commit `SECURITY.md` as `docs(<NN>): add security check` when `planning` is `commit`. When it is `local`, leave it uncommitted.

## Rules

- Never write a secret value into the document. Cite its location only.
- A threat with no evidence is `missing`, whatever the summary says.

Adapted from GSD (MIT), see NOTICE-GSD.md
