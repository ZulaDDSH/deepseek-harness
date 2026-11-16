# Phase {NN}: {Name} - Verification

status: {passed | gaps_found | human_needed}
score: {verified}/{total} truths

## Goal

{Roadmap goal and success criteria, copied in.}

## Observable truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | {truth} | VERIFIED / FAILED / NEEDS HUMAN | {file:line or command output} |

## Artifacts

| Path | Exists | Substantive | Wired |
| --- | --- | --- | --- |
| `{path}` | yes / no | yes / stub | yes / not wired |

## Checks run

- `{command}`: exit {code}; {key output}

## Anti-patterns

- `{path}:{line}`: {TODO, placeholder, console-only handler or skipped test}

## Human verification

1. {What a person must look at or try, and the expected result}

## Gaps

- **{truth}**: {evidence}. Smallest fix: {change}.
