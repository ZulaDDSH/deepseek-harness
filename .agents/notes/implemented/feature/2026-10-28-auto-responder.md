# Agent Note: Auto responder

Status: implemented

## Problem

When a working agent stops, the user has to read its last message, judge whether the work is finished, and type the next instruction. For long tasks that is repetitive: the agent often stops early, skips a verification step, or asks something it could decide itself.

## Decision

The Orchestrator & Subagent Setup view has an Auto responder switch, stored as `autoResponder: { enabled }` on `SubagentSetup`. It is per session or a global default, and works whether or not subagent mode is on.

1. **Trigger** — `installAutoResponder` (`packages/api/session-controller/src/auto-responder.ts`) reacts to `agent/status` going idle after a `completed` turn. Subagent child sessions are never reviewed, and each turn is reviewed once.
2. **Review** — one auxiliary `ctx.llm.stream` call on the session's own model route receives the latest user request and the agent's last message as JSON. It answers with the next message for the agent or exactly `DONE`. A 60 s timeout bounds the call.
3. **Reply** — a non-`DONE` answer is sent with `agent.followup` as a plain `user` message with no `rpcId`, so auto-review never mistakes it for a human instruction. The reviewer is told never to approve a push, merge, deletion, or purchase.
4. **Loop guard** — at most three auto replies per real user prompt. A real user message resets the count and aborts an in-flight review; so does agent disposal. A reply is dropped if the turn, idle state or setting changed while the model answered. Turns started by hooks or background wakes are never reviewed, and the reviewer prompt treats the agent's text as untrusted data. Failures log a warning and leave the session untouched.

5. **Memory** — the reviewer may answer `MEMORY: <query>` to read saved Memorix notes for this workspace, at most twice per review. The lookup goes through the `memory/lookup` waterfall event, which `MemoryAutomation` answers with its existing project-scoped search; with no provider the reviewer is told no notes were found.

## Alternatives considered

**Reviewer as a subagent role.** Rejected: it needs subagent mode and routing setup, and a subagent cannot send to its parent's chat as the user.

**Reply with an `rpcId` like a typed message.** Rejected: auto-review treats `rpcId`d user messages as human permission intent, which would let model-written text approve actions.

**Read history with `snapshotEvents` at review time.** Rejected: the sync readers are lint-banned in production; state is folded from delivered events instead.

**Native tool calls for memory.** Rejected: a text prefix avoids tool schemas and tool-call history for a two-round lookup.

## Consequences

- Each stopped turn costs one extra short LLM call while the switch is on.
- The reply cap and reviewer model are fixed; a configurable cap or reviewer override is a possible follow-up.
- State is in memory, so a resumed session reviews nothing until its next real turn.
