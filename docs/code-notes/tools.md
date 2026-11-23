# tools code notes

## packages/core/tools/src/index.ts:ToolsService::preflight (issue 62)

A tool that reruns a derived command itself, such as `watch` repeating a shell command, never passes through the call pipeline, so PreToolUse hooks and approval rules matched to another tool name never see the repeat. `preflight` lets that tool ask the host for the decision a real call would get: it prepares a throwaway execution through the same `ToolExecutionPipeline.prepare` used by `execute`, which runs the `tools/pre-execute` waterfall, resolves an `ask` through the approval service, and checks guards, then stops before dispatch. `dispatch` maps to `{ allowed: true }`; every other preparation (a hook denial, a rejected or cancelled approval, a guard, an execution error) maps to `{ allowed: false, reason }` with the model-facing denial text.

The call is additive: it appends no session events, runs no tool body, and does not run post-execute policy. Approval requests are real, so an `ask` decision prompts the user once per preflight. The caller supplies the call id, agent, and signal; cancellation follows the pipeline's rules and yields a denial.

## packages/core/tools/src/pipeline.ts:operationSummary (finding 140)

The approval request carried only the tool name, call id and the asker's reason, so an SDK client without the tool-call stream could not tell what it was approving. `serviceAsk` now also passes `operation`, a bounded summary of the call's arguments. `operationSummary` walks the JSON arguments to depth 4, keeps at most 16 array items and 32 object keys, truncates strings to 256 characters, replaces the value of any key matching a secret-name pattern (password, secret, token, api key, authorization, credential, cookie) with `[redacted]`, and cuts the serialized text at 1024 characters. Redaction is by key name only: a secret embedded in a command string or a free-text value is not detected, so the summary is not a confidentiality boundary. `reason` and `displayReason` are forwarded unchanged and the audited `approval/asked` event does not record `operation`.
