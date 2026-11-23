# ui-commands code notes

## packages/client/ui-commands/src/client/popup.ts:PopupSelectController.load

Finding 288. `load` called the provider's `options` function and attached `.then` handlers to the returned promise, so a provider that threw synchronously before returning a promise escaped `open`/`retry` after the shell had already published `open` and `pending`, leaving the picker loading with no error or Retry. A synchronous throw is now turned into a rejected promise, so it takes the same binding-checked failed path as an asynchronous rejection (error text, Retry, search retained, late settlements after dismissal or a newer binding dropped).

## packages/client/ui-commands/src/client/service.ts:CommandService.execute

A claimed command submission returns an error outcome for a handler error result whether or not it carries attachments, so the composer keeps the typed draft for correction; the durable command lifecycle display is unchanged and the command is executed once, because the outcome is derived from the single `commands.execute` response.

## packages/client/ui-commands/src/client/directory.ts:CommandDirectory.refresh

Refreshes are coalesced per Session: one fetch flies per entry and any refresh requested meanwhile only marks one rerun, so a burst of invalidations costs at most two fetches per Session. A requested refresh discards the result of the fetch already flying (reset and invalidation mean it may describe the old catalog) and the rerun publishes instead; waiters are woken only by a published outcome. Replaces the earlier per-call epoch guard, which let every call start its own fetch and hold a Session reference until it settled.

## packages/client/ui-commands/src/client/directory.ts:CommandDirectory.entry

The entry map is bounded by MAX_ENTRIES; creating an entry beyond the bound evicts the oldest entry that has no fetch in flight and no waiter, which only costs a refetch when that Session is used again. invalidateAll refreshes only ready or pending entries, because cold and failed entries are refetched on demand by warm and ensureReady, so closed Sessions that failed their catalog stop being revisited on every change event.

## packages/client/ui-commands/src/client/service.ts:CommandUiRuntime.runDetached

Finding 287 made `execute` map a handler error result to an error outcome, which `runDetached` (menu pick, bare enter, internal handled paths) treated like an admission miss, so the host's durable `command/done` flow node and a composer notice both showed the failure. `runDetached` now calls `submit` directly and only notices an unmatched line (`undefined`) or a rejected call; a handler error stays with the flow node. The claimed submit path still returns the error outcome so the composer keeps the draft, and it shows the notice text next to the flow node by design.
