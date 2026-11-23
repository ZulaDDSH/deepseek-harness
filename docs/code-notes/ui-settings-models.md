# ui-settings-models code notes

## packages/client/ui-settings-models/src/client/authorization-operations.ts:createAuthorizationOperations

Finding 205. `begin` initialised its status to `cancelled` and returned it when the iterable ended cleanly without an `end` item, so a premature stream end was reported as a cancellation even though a credential could already have been committed. It now tracks whether a terminal item arrived and otherwise returns the `interrupted` outcome, whose outcome is unknown.

Finding 206. `list` converted a refused listing into an empty array, which the card read as "no flow exists" and hid itself. It now rejects with the Host's message on a refusal, so a failed read is distinguishable from a successful empty list; `ProviderEditor` swallows that rejection and keeps the flow it already holds.

## packages/client/ui-settings-models/src/client/SignInCard.tsx:SignInCard

Finding 205. An `interrupted` outcome re-reads the flow entry (the credential state), tells the page to refresh its rows because a commit may have happened, and shows the `signInInterrupted` notice with the retry button instead of the cancelled notice.

Finding 206. `reloadEntry` now tags each read with a sequence number so an older overlapping read cannot overwrite a newer one, catches a rejected or refused listing into `loadFailure`, and keeps any entry already held. A card with no entry and a load failure renders the error with a Retry button instead of disappearing; a successful empty list still renders nothing.
