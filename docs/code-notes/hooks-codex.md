# hooks-codex code notes

`packages/experimental/hooks-codex/src/index.ts:apply`: by default a missing, unreadable or invalid hook config is logged and the plugin registers nothing, and unsupported handlers are skipped, so a deployment relying on a `PreToolUse` hook as a guard silently loses it. The `mandatory` option makes both conditions throw from `apply`, which refuses plugin activation instead of continuing unguarded.

`packages/experimental/hooks-codex/src/index.ts:runPoint`: `updatedInput` is parsed by the shared codec but never applied, so a hook expecting to sanitize a tool call leaves the original arguments in effect. Under `mandatory` an output that requests `updatedInput` is converted to a deny with an explanatory reason until rewrite semantics exist. Covered by `tests/mandatory.spec.ts`.

`packages/experimental/hooks-codex/src/index.ts:apply`: `SessionStart` is awaited inside the `agent/created` listener, so a slow or stuck hook delays Agent creation for its configured timeout and multiple matching hooks run serially; the README previously called the run detached (finding 224).
