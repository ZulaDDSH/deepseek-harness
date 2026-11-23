# file-upload code notes

`packages/client/file-upload/src/index.ts:FileUploads.assertSessionQuota`: receipts stayed staged until a prompt sent them, so one Session (and any reader allowed `fileUploads/upload` on it, finding 30) could accumulate unlimited receipts. Each Session may hold at most `MAX_STAGED_PER_SESSION` (100) receipts and `MAX_STAGED_BYTES_PER_SESSION` (4 GiB) bytes; the check runs before storing and `stage` re-checks with the real size, so a concurrent burst can overshoot by the in-flight uploads only, which the store-wide quota in attachment-local bounds. Staged receipt accounting is memory only; the bytes already written to the attachment store are not removed when a receipt is refused, because content-addressed objects can be shared.

The browser has no call that retires a receipt when the user removes a draft file, so removed-but-unsent uploads keep counting towards the Session cap until a prompt uses them or the Session is disposed; the refusal message says so.
