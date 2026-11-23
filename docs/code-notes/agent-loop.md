# agent-loop code notes

## packages/core/agent-loop/src/agent.ts:Agent::kick (issue 24)

`turn()` decides "no pending input" inside its async body, but the driver only commits the idle phase in `kick`'s `finally`, at least one microtask later. A settlement notice (`inject`, no wake) or a `steer` landing in that gap saw a running, unaborted driver: inject has no wake, and `wakeDriver` deliberately does not latch for a live driver. The message then sat queued until unrelated activity opened a turn.

Fix: `turn()` records `drained` when it ended because the inbox was empty. `kick` re-checks `inbox.hasPending` synchronously after the await and before the idle commit (no await between the re-check and the `finally`), and rearms the phase for another turn when input arrived. Only a drained end re-checks, so blocked/empty/error endings keep their existing no-restart behaviour, and a disposed agent never restarts.

Regression: `packages/core/agent-loop/tests/retirement-race.spec.ts`.

## packages/core/agent-loop/src/agent.ts:Agent::rearm (issue 24)

Shared by the in-turn continuation and `kick`'s retirement re-check. A fresh `AbortController` makes a wake latch set on the previous controller stale, because the live driver claims the queue itself; step restarts at 0.
