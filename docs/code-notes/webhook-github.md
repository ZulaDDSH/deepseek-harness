# webhook-github code notes

## packages/experimental/webhook-github/src/handler.ts:createGitHubWebhookHandler (issues 107, 108, 109)

Replay (107): the HMAC covers only the body, so `x-github-delivery` and `x-github-event` are attacker-chosen on a replay and a delivery-ID dedupe would not stop it. The handler therefore remembers the SHA-256 of each verified raw body, never the signature or payload, in a bounded insertion-ordered map. A verified body seen again inside `replayWindowMs` is acknowledged with `202` and not dispatched. The map is capped at `MAX_REPLAY_ENTRIES`; the oldest entry is evicted first, so a flood of distinct signed bodies can age out an old entry early. The memory is per plugin instance and lost on restart, so a replay after a restart or after the window is accepted again. `replayWindowMs: 0` turns it off. A legitimate GitHub redelivery has the same body, so it is also suppressed until the window passes; an operator who must redeliver sooner sets `replayWindowMs: 0` or waits.

Durability (108): `packages/experimental/webhook-github/src/handler.ts:createGitHubWebhookHandler` calls `ctx.webhookRuntime.dispatch` synchronously and answers `202` after it returns; rules run after the response. The adapter does not persist anything itself: when the runtime journal is active (default under the Host data directory, `packages/experimental/webhook/src/index.ts:WebhookRuntime::dispatch`) the delivery is fsynced before `dispatch` returns, so before the `202`, and replayed after a crash, at least once; a journal write failure throws from `dispatch` and the handler answers `503`. See `docs/code-notes/webhook.md` and the webhook README. With the journal off or unavailable a crash after the `202` still loses the delivery; the README states that window.

Ingress (109): unauthenticated bodies are buffered before the HMAC is checked. The three required headers are now validated before the body is read, at most `maxConcurrentRequests` requests may be in the read-verify-dispatch section (excess get `429`), and a body that is not complete within `bodyTimeoutMs` destroys the request. Buffered bytes are therefore bounded by `maxConcurrentRequests * maxBodyBytes`. Connection counts and rate limits stay with the reverse proxy.

## packages/experimental/webhook-github/src/body.ts:readBoundedUtf8Body (issue 109)

The optional `timeoutMs` arms a timer that destroys the request; the aborted iteration is then reported as `408` rather than the generic aborted-body `400`.
