# sdk-server code notes

## packages/sdk/server/src/server.ts:HarnessSdkJsonRpcServer (finding 140)

The `approval/request` bridge copies `request.operation` into `ApprovalRequestParams.operation` when present, so a Python or TypeScript SDK client can show what it is approving. The field is already bounded and redacted by the asker; the bridge adds no limit of its own.
