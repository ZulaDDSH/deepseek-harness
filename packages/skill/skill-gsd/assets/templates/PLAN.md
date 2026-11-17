---
phase: NN-name
plan: PP
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
requirements: [REQ-01]
must_haves:
  truths:
    - "{observable behaviour the phase goal needs}"
  artifacts:
    - path: "{file}"
      provides: "{what it must contain}"
  key_links:
    - from: "{file}"
      to: "{file}"
      via: "{import, call or route}"
---

<objective>
{What this plan builds.}

Purpose: {why it matters for the phase goal}
</objective>

<context>
@.planning/PROJECT.md
@.planning/phases/NN-name/CONTEXT.md
@{relevant source file}
</context>

<tasks>

<task type="auto">
  <name>Task 1: {action-oriented name}</name>
  <files>{path, path}</files>
  <read_first>{file to read before editing}</read_first>
  <action>{exact change: identifiers, parameters, paths and expected values. Say what to avoid and why.}</action>
  <verify>{runnable command, for example a test run or a grep}</verify>
  <acceptance_criteria>
    - {grep-checkable condition, for example "src/x.ts exports foo"}
  </acceptance_criteria>
  <done>{measurable result}</done>
</task>

</tasks>

<verification>
- [ ] {command that proves the plan's goal}
</verification>

<success_criteria>
- Every task is committed, one commit per task.
- Every verify command passes.
</success_criteria>
