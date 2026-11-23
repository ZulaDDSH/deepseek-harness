# tools code notes

## packages/core/tools/src/index.ts:ToolsService::preflight (issue 62)

A tool that reruns a derived command itself, such as `watch` repeating a shell command, never passes through the call pipeline, so PreToolUse hooks and approval rules matched to another tool name never see the repeat. `preflight` lets that tool ask the host for the decision a real call would get: it prepares a throwaway execution through the same `ToolExecutionPipeline.prepare` used by `execute`, which runs the `tools/pre-execute` waterfall, resolves an `ask` through the approval service, and checks guards, then stops before dispatch. `dispatch` maps to `{ allowed: true }`; every other preparation (a hook denial, a rejected or cancelled approval, a guard, an execution error) maps to `{ allowed: false, reason }` with the model-facing denial text.

The call is additive: it appends no session events, runs no tool body, and does not run post-execute policy. Approval requests are real, so an `ask` decision prompts the user once per preflight. The caller supplies the call id, agent, and signal; cancellation follows the pipeline's rules and yields a denial.
