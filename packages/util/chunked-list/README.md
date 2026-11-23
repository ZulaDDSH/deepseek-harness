---
description: "Immutable append-only lists for projection state, with bounded append copying, insertion-order iteration, and Zod checkpoint validation."
kind: "package-library"
---

# @deepseek-ai/dsh-chunked-list

## Summary

`dsh-chunked-list` lets callers append values while retaining earlier list versions without copying the whole collection. Callers can iterate every value in insertion order and validate JSON checkpoints with their own value schema. The subagent catalog uses it for immutable projection state.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use this list when an append-only collection needs immutable versions and JSON-compatible storage. An empty list is `undefined`; appending returns a new head without modifying existing nodes. The list shares stored values by reference, so callers must treat them as immutable. `chunkedListLength` counts values from the block shape without visiting them, and `chunkedListSuffix` returns the last values in order by visiting only the path to them, so a consumer can publish one appended value without iterating the list.

```ts
import { appendChunkedList, iterateChunkedList } from '@deepseek-ai/dsh-chunked-list'

const first = appendChunkedList(undefined, 'first')
const second = appendChunkedList(first, 'second')
console.log([...iterateChunkedList(second)])
```

The example produces `['first', 'second']`; `first` still contains only its original value. `chunkedListSchema(valueSchema)` validates JSON checkpoints and rejects unknown fields, invalid values, empty lists, and mis-sized or mis-ordered blocks. Use `.optional()` on the schema when the containing field also permits an empty list. See the [source contracts](src/index.ts) for the operations.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The newest 0 to 63 values sit in a `tail`; a full tail is sealed into a 64-value block, and 64 equal-height blocks merge into one block a level up, like a base-64 counter. Appends copy at most the tail and share every older block, taking bounded work. Nesting depends on the height (at most 9 levels, enough for 64^9 values), not on the length. Iteration visits all N values in O(N) time and uses O(log N) scratch space. The schema checks the exact 64-wide blocks, descending heights, and at most 63 blocks per height.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Persistent list operations and checkpoint validation |
| [`tests/chunked-list.spec.ts`](tests/chunked-list.spec.ts) | Version isolation, ordering, structural sharing, bounded nesting, and checkpoint acceptance |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Utility package map](../README.md) — shared primitives.
- [Subagent catalog decision](../../../.agents/notes/implemented/architecture/2026-09-01-parent-owned-subagent-catalog.md) — why projection state uses chunks.

-----

<a id="model-experience"></a>
## Model Experience

None, as this collection registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Append-only access** — callers needing removal or random access need another collection.
- **Checkpoint shape** — the nesting depth is bounded by the height, so length no longer reaches runtime nesting limits. The shape is not the earlier linked chain, so a projection that stores it bumps its `stateVersion`. Stored values must themselves support the caller's serialization format.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
