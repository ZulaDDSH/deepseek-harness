# timeout code notes

`packages/util/timeout/src/index.ts:idleWatchdog` - `next()` races the pending demand against the fused signal (upstream cancellation or the idle deadline), not only the idle timer, and rejects with that signal's reason. A provider read that ignores its abort signal therefore ends at caller cancellation instead of up to the idle interval later; the adapters already classify a caller abort as ABORTED and detach the iterator drain, so they need no change (finding 363).

`packages/util/timeout/src/index.ts:idleWatchdog` - a demand made on an already aborted signal is still handed to the iterator, because the adapters rely on it to emit its aborted finish chunk; only an abort that lands during the demand settles it early, so a never-settling read started after cancellation still waits for the idle deadline.
