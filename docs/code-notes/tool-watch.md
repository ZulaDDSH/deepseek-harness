# tool-watch code notes

## packages/jobs/tool-watch/src/index.ts:apply (issue 62)

A watch reruns its command through `ctx.shell` directly, so the tool-call pipeline, and with it any PreToolUse hook or approval rule matched to a shell tool name, never sees a repeat. A deployment that used such a hook as its command guard could therefore deny `bash` yet still allow the same command through `watch`. The pipeline offers no preflight API that a plugin can call for a command it is not dispatching (`ToolsService` only runs a whole call), so the hook boundary itself cannot be reused from this package.

Fix: the plugin owns an explicit command policy in its configuration: `denyCommands` (JavaScript regular expressions; a command matching any is refused) and `allowCommands` (when non-empty, a command must match one). `apply` compiles them once and builds `WatchPlan.refusal`, which `watch` consults when the call arrives and `poll.ts:runCheck` consults again before every repeat. A refusal at the call is a tool error and no job starts. A refusal at a repeat settles the watch as `failed` at once with the policy reason, instead of counting toward `maxConsecutiveErrors`, so a policy change or a command that stops being allowed ends the loop without further runs. Cancellation is unchanged: the abort signal is checked before the refusal result is used.

Limit: this is a pattern policy the operator mirrors from its shell hook rules, not a parse of shell syntax, and it does not replace the sandbox. A command that obfuscates itself can evade a deny pattern, so a deployment that needs a strict guard should use `allowCommands`. Full hook parity needs a core tools preflight API.
