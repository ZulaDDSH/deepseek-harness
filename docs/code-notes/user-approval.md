# user-approval code notes

## packages/interaction/user-approval/src/types.ts:ApprovalRequestEvent (finding 140)

`operation` is an optional bounded, redacted summary of the operation's arguments produced by the asker (the tool pipeline). It travels on the `approval/request` waterfall only; `ApprovalService.request` does not copy it into the `approval/asked` audit event, so session logs keep the reason text and nothing else. Answerers must treat it as display text, never as a decision input.
