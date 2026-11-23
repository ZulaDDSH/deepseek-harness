# tool-todo code notes

## README states the per-turn projection reset (finding 151)

- `packages/todo/tool-todo/src/index.ts:apply` (the `todos` projection fold) deliberately returns `null` on `turn/start`, and `packages/todo/tool-todo/tests/projection.spec.ts` pins it. The finding is a documentation mismatch, so the README summary and call-mechanics text now separate the historical `todo/write` events (kept in the log) from the current-list projection (cleared each turn); the code is unchanged.
