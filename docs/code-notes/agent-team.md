# agent-team code notes

## packages/team/agent-team/src/index.ts:TeamService::recoverHistoricalMessage (issue 69)

Older Team sessions hold `team/message/queued` records, acknowledged by `team/message/delivered`. The current runtime sends peer messages through the subagent inbox and never reads the old mailbox, so an unacknowledged record was stranded and no API could say what became of it. The projection already exposes these as `historicalMessages[].delivered === false`; `TeamService::pendingHistoricalMessages` lists them for the Lead.

`recoverHistoricalMessage` is the deliberate decision for one such message, made by the Lead only. `discard` appends the existing `team/message/delivered` acknowledgement so the record leaves the pending view; nothing is sent. `replay` first checks the target Session for a user message that already carries the matching `team-message` source (a delivery whose acknowledgement was lost); if found it only acknowledges. Otherwise it sends the content through `subagents.sendMessage`, prefixed with a line naming the original sender, then appends the acknowledgement and flushes. Each call runs inside the Lead's journal transaction, and a message that is no longer pending returns `already-resolved`, so repeating a call is safe.

Limit: a crash after the send and before the acknowledgement is flushed leaves the message pending, and a later replay sends it again (at-least-once). The sender-source check cannot see the new inbox delivery because the subagent runtime stamps its own source. A target that cannot be reached makes `replay` throw and leaves the message pending, so the Lead can discard it instead.
