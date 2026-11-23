# connection code notes

## packages/client/connection/src/http-bridge.ts:BufferedBodyBudget (issue 162)

Each buffered `/api` body was bounded by `maxRequestBodyBytes`, but nothing bounded the sum: several admitted clients could each hold a body just under the cap at once, and `Buffer.concat` briefly holds a second copy of one body while its chunks are still referenced.

`BufferedBodyBudget` is a Host-wide byte counter. `bridge` reserves twice the size of each received chunk before keeping it (the chunk and its share of the `Buffer.concat` copy, so a request that was admitted while reading never fails at the concat), releases the chunk half after the concat drops the chunks, and releases the rest when the bridge call returns (the retained body lives as long as the handler runs). A reservation that would exceed the budget answers 503 with `Retry-After: 1` and `Connection: close` and destroys the request, so the client may retry once other bodies finish. The budget is `BUFFERED_BODY_BUDGET_FACTOR` (4) times `maxRequestBodyBytes`, so one maximum-size body (which peaks at twice its size) always fits and more than two concurrent maximum-size bodies queue behind 503 instead of exhausting memory; it is derived from the existing limit rather than a new config field.

Not done: a per-peer share of the budget (one admitted peer can still take the whole budget), and streaming of suitable payloads; both are listed in the package README. `rpc-host.ts:handleApi`'s direct `bridge` call without a budget uses the process-wide default budget sized for the default cap.
