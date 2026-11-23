# hooks-claude-code code notes

`packages/experimental/hooks-claude-code/src/index.ts:apply`: by default a missing, unreadable or invalid hook config is logged and the plugin registers nothing, and unsupported handlers (`http`, `mcp_tool`, `agent`) are skipped, so a deployment relying on a `PreToolUse` hook as a guard silently loses it. The `mandatory` option makes both conditions throw from `apply`, which refuses plugin activation instead of continuing unguarded. The inventory report still carries the failed status for the non-mandatory case.

`packages/experimental/hooks-claude-code/src/index.ts:runPoint`: `updatedInput` is parsed but not applied, so a hook expecting to sanitize a tool call leaves the original arguments in effect. Under `mandatory` an output that requests `updatedInput` is converted to a deny with an explanatory reason until rewrite semantics exist; without `mandatory` it is still warned and ignored.

`packages/experimental/hooks-claude-code/src/index.ts:evaluatePrompt`: a prompt hook that times out, errors, has no model route or no llm service returns a neutral output (fail open). Under `mandatory` the same failures return a deny carrying the failure message, so the guarded action is refused when no verdict is available. Covered by `tests/mandatory.spec.ts`.
