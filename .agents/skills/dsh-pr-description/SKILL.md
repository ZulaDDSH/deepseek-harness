---
name: dsh-pr-description
description: Use when creating a deepseek-harness pull request, or when updating its description after later changes or a handled review round. Defines each description section, Issue references, test design, and change-specific disclosures.
user-invocable: false
---

# Writing PR descriptions

This skill defines what a deepseek-harness PR description contains, how to write it, and when to update it. The [PR template](../../../.github/pull_request_template.md) supplies only the section headings and placeholders; this skill owns the requirements for each section. Every PR description follows this skill, including PRs created with `gh pr create --body-file`, which skips the template.

## Scope

- Write the complete description when you create the PR.
- After the PR exists, update the affected sections when the description no longer matches the PR, at times you judge suitable.
- Each PR in a stack has its own description, which covers only that layer's changes against its base branch.

## Description structure

The description uses three second-level headings, in this order: `## Motivation`, `## Changes`, and `## Testing`.

Write fixed section headings and labels, such as **Interface changes**, **Behavior changes**, **Test design**, and **Test entries**, in English. Write table headers and the rest of the description in the PR description's language, Chinese unless a human asked for another language.

### Motivation

- State the problem in one sentence.
- Reference at least one same-repository Issue: use `Fixes #N`, `Closes #N`, or `Resolves #N` when the PR resolves it, and `Refs #N` when it only gives context. PR numbers do not count as Issue references, and neither do references inside HTML comments, code fences, or inline code. [Issue management](../../../.github/issue-management/README.md) owns the exact rules and the Priority matching.

### Changes

- Interface changes: summarize changes to commands (including repository scripts), flags, configuration keys, environment variables, public exports, plugin registration values, protocols, or persisted formats; write None when there are none.
- Behavior changes: summarize results that users, models, developers, or the system can observe, including defaults, performance, timing, and output; write None when there are none. Changes to documentation and agent instructions, such as READMEs, AGENTS.md, and skills, are behavior changes for the readers they guide.
- State only behavior that the diff guarantees and the tests cover.

### Testing

Testing starts with the test design, followed by the test entries.

**Test design**: summarize how the tests cover each item in Changes and why that coverage is complete. Choose the form by change type:

| Change type | What the test design shows |
|---|---|
| Behavior change | A behavior matrix of scenario × behavior before × behavior after × covering test, showing which scenarios failed or differed before the change |
| Performance change | Before and after values per stage or scenario, with the measurement conditions: machine, run count, and how the value is taken |
| Refactoring or migration without behavior change | How the unchanged behavior is shown: byte-for-byte comparison, unchanged snapshots, or old-versus-new comparison tests |
| Documentation only | How the content is checked: links, bilingual pairing, example compilation, or similar |

When the PR mixes change types, give one form for each type present. Items that Changes lists as None need no test design.

**Test entries**:

- Add one entry per test method; state the command or steps visibly, and the behavior it covers.
- List only tests that have run, with their results; add later runs when the description is updated. State whether the evidence comes from a local run or from CI.
- Put reviewable evidence, such as test output, screenshots, recordings, or logs, in that entry's `<details><summary>Proof</summary>` block; when the full output is long, the block may hold the command, the counts, and a result summary.

### Change-specific disclosures

Write each disclosure in the section it concerns, usually Changes, after a bold English label that names it, such as **Existing test behavior**; do not add headings.

| Change | What the description states | Rule owner |
|---|---|---|
| Changing the behavior an existing test describes | Why the behavior changed | The Tests describe behavior rule in [root AGENTS.md](../../../AGENTS.md) |
| Raising a ceiling in `scripts/doc-budgets.manifest.json` | Each raised ceiling with its old and new value, and why the words are necessary | [Wordcount budgets](../../../docs/AGENTS.md#wordcount-budgets) |
| Changing product-user-visible GUI behavior | An embedded demonstration GIF, with the disclosures that record-browser-gif requires beside the embed; for each GUI change without a GIF, a statement that none is embedded and why | [record-browser-gif](../record-browser-gif/SKILL.md#every-gui-pull-request-includes-a-gif) |

## Creating and updating the description

1. Write the description to a file that git ignores, such as `.artifacts/pr/body.md`. Create the PR with `gh pr create --body-file <file>`, or update it with `gh pr edit <number> --body-file <file>`; when the description embeds a GIF, follow [record-browser-gif](../record-browser-gif/SKILL.md) and use `--attach`.
2. Before an update, save the current description with `gh pr view <number> --json body --jq .body`, and change only the sections that need it: keep content and media the author wrote, and remove statements that no longer match the code.
3. After writing, read the description back and confirm that all three sections are present and that each one matches the current code and test results.
