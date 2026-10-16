---
name: gsd-ui-review
description: Audit the frontend code a phase changed against six pillars (copywriting, visuals, color, typography, spacing, experience design), score each out of four, and write UI-REVIEW.md. Use when the user runs /gsd-ui-review for a phase or asks for a UI audit of the code.
---

# /gsd-ui-review

A static, code-level audit of the user interface a phase changed. It scores six pillars and lists the evidence for each score.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

Argument: a phase number (default: current phase).

## Steps

1. Collect the frontend files the phase changed: components, templates, style sheets and user-facing strings, as /gsd-code-review step 1 does. If the phase has no frontend change, say so and stop.
2. Find the design context with `glob` and `grep`: a style guide, design tokens or theme files. If none exist, say so in the report and score against general standards.
3. Spawn two `reviewer` children in one message, with `run_in_background` set to true.
   - The first scores pillars 1 to 3, and the second scores pillars 4 to 6.
   - Each gives a score from 1 to 4 per pillar, with the reason and `file:line` evidence.
   - Reviewers read the code only. If the user wants a visual check of a running app, record that as an open item for them.
4. Collect the replies with `job_output`. Write `phases/<NN>-<slug>/UI-REVIEW.md`: a score table, then the findings for each pillar with a suggested fix.
5. Ask with `ask_user_question` whether to fix the findings in pillars scoring 2 or lower. Options: "Fix pillars scoring 2 or lower (Recommended)" and "Leave them for later". To fix, use `coder` children, one commit per fix, as `fix(<NN>-ui): <summary>`.
6. Commit `UI-REVIEW.md` as `docs(<NN>): add UI review` when `planning` is `commit`. When it is `local`, leave it uncommitted.

## The six pillars

1. Copywriting: call-to-action labels, empty and error states, clarity of text.
2. Visuals: hierarchy, focal points, use of icons and imagery.
3. Color: palette use, contrast, consistency with the tokens.
4. Typography: type scale, weights, line length.
5. Spacing: rhythm, alignment, grid use.
6. Experience design: flows, feedback on actions, loading and error paths, accessibility basics.

Adapted from GSD (MIT), see NOTICE-GSD.md
