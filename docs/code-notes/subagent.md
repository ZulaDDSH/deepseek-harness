# subagent code notes

## packages/subagent/subagent/src/manager.ts:SubagentManager::deliverToMember (issue 33)

Inbox admission is synchronous and in memory; the JSONL backend batches the resulting `inbox` event, so `send_message` and host prompts used to return a message id before the insertion was on disk. A crash in that window lost an accepted instruction with no replay.

Fix: after the per-child lock is released, the accepted target's Session is flushed (`ctx.sessions.flush`) before the id is returned. The flush runs outside the lock so other deliveries are not serialized behind storage latency, and it never un-accepts: the message is already in the live inbox and will run. A flush failure is logged and the id is still returned, because retrying would duplicate a message that is already queued; the id is the stable identity of the accepted message. Memory-only sessions flush as a no-op.

## packages/subagent/subagent/src/manager.ts:SubagentManager::interrupt (issue 60)

The README's "wake gap during cancellation convergence" limitation was stale: `interrupt` cancels with `keepInbox`, delivery uses the waking `steer`/`followup`, and `Agent.send` classifies a waking send after abort as next-turn input, latches the wake and replays it when the aborted driver converges. The regression `runs a send_message accepted between interrupt and idle once the child converges` in `tests/continuation.spec.ts` passes on unmodified code, confirming the finding. The distinct driver-retirement race (input landing after the final inbox check) is closed in `packages/core/agent-loop/src/agent.ts:Agent::kick` (issue 24), so no limitation remains.
