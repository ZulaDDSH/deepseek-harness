# sdk-protocol code notes

`packages/sdk/protocol/src/transport.ts:JsonRpcLineTransport::drainLines`: the input accumulator had no maximum, so a peer sending an endless line without a newline grew the process without bound, and a complete oversized line was parsed in full. A line, or an unterminated remainder, longer than `maxFrameChars` (default `MAX_FRAME_CHARS`, counted in UTF-16 code units so memory stays bounded for any encoding) now fails the transport through `failLimit` instead of falling into the "malformed lines are ignored" path.

`packages/sdk/protocol/src/transport.ts:JsonRpcLineTransport::write`: output was written without looking at backpressure, so a peer that stopped reading while the session kept emitting events made `Writable` buffer without limit. The transport now counts bytes written but not yet acknowledged by the write callback; a frame that would push that count past `maxOutputBytes` (default `MAX_OUTPUT_QUEUE_BYTES`) fails the transport through `failLimit` and is not written. The `Writable` itself is the ordered queue, so ordering is unchanged and no frame is dropped while the transport is healthy.

`packages/sdk/protocol/src/transport.ts:JsonRpcLineTransport::failLimit`: a limit failure is terminal and loud. It rejects pending and future requests with the limit error, detaches the input listeners, destroys both streams without an error argument (a destroy error would surface as an unhandled stream `error` event after our listener is gone), settles `flush()` with the limit error even when the output never calls back, and calls the `onFailure` handler once so the owner can tear the process down. After the failure `notify()` and handler responses are no-ops: they run inside event emitters and must not throw into them, and the peer is already being terminated.

`packages/sdk/protocol/src/transport.ts:JsonRpcLineTransport::close`: unchanged: it still does not destroy the streams. Only a limit failure destroys them.

## packages/sdk/protocol/src/types.ts:ApprovalRequestParams (finding 140)

`operation` is an optional display-only summary of the operation's arguments (at most 1024 characters, key-name redacted). Clients that ignore unknown fields keep working; the Python model ignores it and exposes it through the raw payload.

## packages/sdk/protocol/src/types.ts:HarnessSdkRequestMap (finding 126)

`session/cancel` takes `{ sessionId }` and answers `{ cancelled }`. It is an acknowledgement that cancellation was requested, not that the Session is quiescent: the outcome and settlement path stays `session/wait` plus the `session.status` and `turn/end` events, which also answer an ambiguous timeout. `cancelled` is true when a live Agent received the cancellation; work still in admission (Session creation, attachment admission, a native command) is rejected in either case. An unknown id never creates a Session. Older runtimes answer `-32603 unknown method`, so a client treats a failed cancel as best effort.

`packages/sdk/protocol/src/types.ts:SessionCancelParams`: the `session/cancel` request carries only the SDK-side Session id; there is no per-operation id because the runtime has no per-operation identity for a prompt before it is queued.

`packages/sdk/protocol/src/types.ts:SessionCancelResult`: `cancelled` reports whether a live Agent received the cancellation, so a client can tell "nothing to cancel" from "cancel delivered" without inferring it from errors.
