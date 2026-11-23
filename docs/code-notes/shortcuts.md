# shortcuts code notes

## packages/client/shortcuts/src/persistence.ts:ShortcutPersistence::edit

Finding 180. Each tab serialized its own read-modify-write, so two tabs could both read document D, both
pass the revision check and each write a full replacement; both reported `saved` and the later write
removed the earlier change. `ShortcutPersistence` now takes an optional `exclusive` runner and `edit`
runs its whole transaction (reread, revision check, validation, write) inside it. The Web adapter
(`webShortcutStorage` in `src/client/storage.ts`) passes `navigator.locks.request` under a lock named after
the storage key, so the transaction is exclusive across tabs of the origin; the tab that loses the race
rereads the winner's document inside the lock, its draft revision no longer matches, and it gets
`stale`, so no edit is silently overwritten. Where the Web Locks API is missing no lock is taken and the
old last-writer-wins window remains; Desktop uses its own atomic file adapter and passes no runner.
Reads outside `edit` are not locked.
