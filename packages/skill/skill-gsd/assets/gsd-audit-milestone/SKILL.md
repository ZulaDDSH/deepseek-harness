---
name: gsd-audit-milestone
description: Audit a milestone against its original intent before it is closed. Check each phase's verification, requirement coverage and integration, then write MILESTONE-AUDIT.md. Use when the user runs /gsd-audit-milestone or asks whether a milestone is complete.
---

# /gsd-audit-milestone

Decide whether a milestone delivered what it promised, using the verification records rather than memory.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults and gate rules are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

Argument: a milestone version (default: the milestone named in `ROADMAP.md` or `STATE.md`).

## Steps

1. Read `.planning/PROJECT.md` for the requirements, and `.planning/ROADMAP.md` for the phases in the milestone.
2. For each phase, read its `VERIFICATION.md` status and gaps, its `UAT.md` status, the count of SUMMARY files against plans, and any open item in `REVIEW.md` or `SECURITY.md`.
3. Check requirement coverage. Every requirement ID in `PROJECT.md` must sit in a phase whose verification passed. Build a table: requirement, phase, status and evidence.
4. Check integration. Spawn one `reviewer` child, read-only, to confirm that the phases connect: shared interfaces have callers, no code path was left dead, and the repository's documented test command passes. It may run that command with `bash` but must not edit files. It reports findings as `file:line`.
5. Write `.planning/MILESTONE-AUDIT.md`.
   - Verdict: `passed` (all requirements covered and verified), `tech_debt` (covered, with open items), or `gaps_found`.
   - The coverage table.
   - The integration findings.
   - The tech-debt list.
6. Commit it as `docs: audit milestone <version>` when `planning` is `commit`. When it is `local`, leave it uncommitted.
7. Report the verdict. For gaps, name the phases to plan with /gsd-plan-phase.
   - Ask with `ask_user_question`, with the options "Plan the gaps (Recommended)", "Accept the tech debt" and "Stop".
   - Under `auto`, report and end without asking.

## Rules

- Quote the verification record for every coverage claim. A requirement with no record is a gap.

Adapted from GSD (MIT), see NOTICE-GSD.md
