---
kind: upgrade-guide
description: "session.selectModel reports a default-model save that is still running after 3 seconds as pending with a defaultSaveId, and session.defaultSaveOutcome reports its final outcome."
---

# Default model save can be pending

## Change

`session.selectModel` waits at most 3 seconds for the default-model save. A save that is still running after that used to answer `defaultSave: 'failed'`, even if it later succeeded. It now answers `defaultSave: 'pending'` together with a `defaultSaveId`. The new owner-only endpoint `session.defaultSaveOutcome` takes `{ sessionId, saveId }` and answers `{ defaultSave }` with `saved`, `unavailable`, `failed` or `pending`. Each call waits at most 3 seconds, so a `pending` answer means ask again. The Host keeps the 32 most recent pending saves per Session. A settled outcome is returned once and then forgotten. An id the Host does not hold, because it was evicted, belongs to another Session, or the Host restarted, is rejected with `session/default-save-unknown`.

The `DefaultSaveOutcome` type now includes `pending`. `SessionSelectModelValue.defaultSave` and `defaultSaveId` are optional additions.

## Migration

1. Handle `defaultSave: 'pending'` as "not settled yet", not as a failure. Do not show a retry prompt for it.
2. When `defaultSaveId` is present, call `session.defaultSaveOutcome` with the Session id and that id. Repeat while the answer is `pending`, and stop after a bounded number of rounds (the bundled client stops after 20).
3. Treat `failed`, `unavailable`, a `session/default-save-unknown` rejection, or running out of rounds as "default not saved". Re-selecting the same model rewrites the default and is safe.
4. A client that ignores `pending` still works: the Session selection is already applied, only the saved default may be unconfirmed.
