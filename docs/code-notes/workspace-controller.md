# workspace-controller code notes

## packages/api/workspace-controller/src/feed.ts:WorkspaceFeed::follow

Finding 135. An access invalidation alone produced no frame, so a non-owner's list went stale. The feed now
takes an optional `refreshes` factory (the controller passes `remoteAccess.changes(principal, ...)`) and a
pump pushes one internal `refresh` frame into the same follower queue per invalidation. Sharing the queue
keeps refreshes ordered with registry events, so the controller answers each one with a `replace` of
`filtered(this.feed.baseline())` computed at processing time and never sends a stale snapshot ahead of a
newer event. The pump's signal is the generation signal joined with a controller aborted when the generation
ends, so a consumer that stops early leaves no pump or access follower behind. `refresh` never leaves the
package: the controller turns it into `replace`. Every invalidation of the principal resends the full filtered
state, even when none of its entries changed; the frame is idempotent on the Client.

## packages/api/workspace-controller/src/index.ts:WorkspaceController::follow

Finding 135. The owner (no principal) has no access follow and gets no refresh frames. A non-owner gets a
`replace` frame on every access invalidation, which also resets the delivered-Workspace set, so a
revoked-then-restored Workspace reappears in the replacement baseline rather than through an `upsert`.
