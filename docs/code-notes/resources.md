# resources code notes

## packages/client/resources/src/client/resources.ts:ResourceRegistry::consume

Finding 182. `consume` ran as a floating promise (`void this.consume(...)`), so a provider whose `open`
threw (for example the subagent chat provider on a malformed restored address) left the record at
`loading` forever and produced an unhandled rejection. The loop is now wrapped: a throw from a still
current, unaborted stream becomes a `failed` snapshot (last value kept) carrying a
`gateway/internal` RemoteError with the thrown message, and nothing escapes. A throw after the
stream was aborted is dropped like any late frame. The provider contract text now says a throw is
reported as a failed snapshot rather than being a bug that crashes. Showing that failure in a tab body
is up to the owner of the tab (the subagent chat tab renders nothing while `value` is undefined).

## packages/client/resources/src/client/resources.ts:ResourceRegistry::hold

Finding 183. A stream that ended on a failure frame (or a throw) stayed `failed` for as long as any
holder remained, and the sidebar pins an open tab, so switching away and back never reopened it.
`ResourceRecord.ended` marks a current stream that finished by itself. `hold` restarts such a record
when a new holder arrives while it is `failed`, so a tab that remounts retries once per remount. A
stream that is still running, or ended `live`, is not restarted; StrictMode's second subscribe finds a
running stream and does nothing. A permanent failure (not-found) is retried on each remount too, which
costs one read. No retry runs on reconnect by itself, and the plan preview offers no retry button.

## packages/client/resources/src/client/resources.ts:ResourceRegistry::evictIdle

Finding 181. Records were never removed. A record with no holder is now tracked in an insertion-ordered
idle set; once more than `MAX_IDLE_RECORDS` records are idle the oldest is dropped from the map and
the address is forgotten. Held records are never evicted, and `hold` re-adds a record that was
evicted between `source()` and the subscribe, so the render-then-subscribe window and the StrictMode
remount keep one stable source per address as long as the address is among the most recently used idle
ones. An address evicted and requested again gets a new source object (one resubscribe in React).
Provider registration now scans at most the held records plus `MAX_IDLE_RECORDS`.
