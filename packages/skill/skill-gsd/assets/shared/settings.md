# GSD settings

The GSD settings are in your instructions, under the GSD section. They are set per Session in Orchestrator & Subagent Setup, or globally in Settings (Orchestrator & Subagents). The GSD section states the effective values. Follow them exactly; do not change them yourself.

| Setting | Values | Default | Effect |
| --- | --- | --- | --- |
| `gates` | `every-step`, `plan-and-ship`, `auto` | `every-step` | When the orchestrator asks the user. See Gates. |
| `planAuthor` | `orchestrator`, `researcher` | `orchestrator` | `orchestrator` writes `PLAN.md` files itself. `researcher` delegates the writing to a `researcher` child; you review its output before the plan check. |
| `planning` | `commit`, `local` | `commit` | `commit`: commit `.planning/` with the project. `local`: add `.planning/` to the repository's `info/exclude` file (see Planning files in `shared/conventions.md`) and never stage or commit it. |
| `checkRounds` | `0` to `5` | `2` | Maximum revision rounds for the plan-check loop and the verify-fix loop. `0` still runs each check once but allows no fix round: report what it found at the gate. |
| `parallelWaves` | `true`, `false` | `true` | `true`: coders for one wave run in parallel. `false`: one plan at a time. |

## Gates

- `every-step`: ask at the end of discuss, plan, execute and verify, and before ship.
- `plan-and-ship`: ask at the end of plan and before ship only. Other steps continue directly.
- `auto`: never ask inside the phase loop. Still stop on a failed step, a blocked verification (`human_needed`, or gaps left after `checkRounds`), and before any push, pull request or merge. Ship always asks before pushing or creating a PR, under every setting.
- Choosing "Run the rest automatically" at a gate switches to `auto` for the rest of the current phase only.
- `/gsd-autonomous` uses `auto` for every remaining phase.

## When the GSD section is missing

If your instructions carry no GSD section (the user ran a `/gsd-*` command while GSD is off), use `every-step`, `orchestrator`, `commit`, `2` and `true`. Tell the user once in this session that GSD can be configured in Orchestrator & Subagent Setup.
