# agent-loop code notes

## packages/core/agent-loop/src/agent.ts:Agent::kick (issue 24)

`turn()` decides "no pending input" inside its async body, but the driver only commits the idle phase in `kick`'s `finally`, at least one microtask later. A settlement notice (`inject`, no wake) or a `steer` landing in that gap saw a running, unaborted driver: inject has no wake, and `wakeDriver` deliberately does not latch for a live driver. The message then sat queued until unrelated activity opened a turn.

Fix: `turn()` records `drained` when it ended because the inbox was empty. `kick` re-checks `inbox.hasPending` synchronously after the await and before the idle commit (no await between the re-check and the `finally`), and rearms the phase for another turn when input arrived. Only a drained end re-checks, so blocked/empty/error endings keep their existing no-restart behaviour, and a disposed agent never restarts.

Regression: `packages/core/agent-loop/tests/retirement-race.spec.ts`.

## packages/core/agent-loop/src/agent.ts:Agent::rearm (issue 24)

Shared by the in-turn continuation and `kick`'s retirement re-check. A fresh `AbortController` makes a wake latch set on the previous controller stale, because the live driver claims the queue itself; step restarts at 0.

## packages/core/agent-loop/src/index.ts:AgentLoop (released inbox checkpoint)

`AgentLoop[Service.init]` registers the inbox projection, and unloading the loop releases that unit. A released projection unit stays in the registry as a predecessor (`packages/session/session-projection/src/index.ts`), and `checkpoint()` keeps the last row of each Session that had one, so after `loop.dispose()` the disposed Agent's session still reports `inbox` (empty queues, `seq` -1) while a Session created afterwards has none. `packages/core/agent-loop/tests/resource-lifecycle.spec.ts` therefore asserts `toHaveProperty('inbox')` for the disposed Agent and `not.toHaveProperty('inbox')` for a fresh Session, the form upstream settled on in eb1713f856. The earlier `toBeUndefined` assertion was reintroduced by the merge a4ae6f2a6b and is not a disposal-ordering regression from the persistence-drain fiber or the kick rearm loop, which do not write the checkpoint.
