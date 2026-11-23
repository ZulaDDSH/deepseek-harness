# sdk-server code notes

## packages/sdk/server/src/server.ts:HarnessSdkJsonRpcServer (finding 140)

The `approval/request` bridge copies `request.operation` into `ApprovalRequestParams.operation` when present, so a Python or TypeScript SDK client can show what it is approving. The field is already bounded and redacted by the asker; the bridge adds no limit of its own.

## packages/sdk/server/src/server.ts:HarnessSdkJsonRpcServer::cancel (finding 126)

A client timeout on `session/prompt` or `session/query` leaves that handler running inside Session creation, `durablePromptContent`, or `commands.execute`. `Agent.cancel` with no active activity is a no-op and arms nothing, so cancelling only the Agent would acknowledge and then let the timed-out prompt enqueue and run anyway. Each Session id therefore has an admission `AbortController` (`admissionSignals`): `prompt` and `query` capture its signal on entry, re-check it after every await before `followup`/`execute`, and pass it (combined with the server lifetime) to `commands.execute`. `cancel` aborts and replaces that controller, so later requests start fresh, then calls `agent.cancel({ kind: 'user' })` on the root (the same cause the ACP adapter uses; it also aborts maintenance such as compaction) and `subagents.interrupt(id, { kind: 'user' })` for each live descendant found through `session.header.parentSession` lineage. The default `keepInbox: false` discards the timed-out message if it was already queued. An aborted turn is not an `agent/error`, so `session/wait` still resolves after a cancel. Cancel waits for nothing: the response is the acknowledgement. Known limit: a request already past its last admission check has been enqueued and is covered by the Agent cancel, not by the signal.
