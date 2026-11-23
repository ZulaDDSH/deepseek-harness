# atomic-write code notes

## writeFileAtomic syncs the file and its directory (finding 35)

- `packages/util/atomic-write/src/index.ts:writeFileAtomic` - the temp file is opened with `open(temp, 'wx', mode)`, written, and `FileHandle.sync()`ed before the rename, so the renamed inode never exposes unflushed data after a crash. A failure here is before publication: the temp file is removed and the original error rethrown, as before.
- `packages/util/atomic-write/src/index.ts:syncDirectory` - after the rename the parent directory is fsynced so the new name survives a crash. Windows cannot open a directory handle from Node, so the call is a no-op there (NTFS journals the rename; the file data itself is flushed above). A filesystem that reports the directory sync as unsupported (`EINVAL`, `ENOTSUP`, `EISDIR`, `EPERM`, `ENOSYS`) is treated as having nothing to sync.
- `packages/util/atomic-write/src/index.ts:AtomicWriteSyncError` - any other directory-sync failure happens AFTER publication: the new content is already visible but its durability is unknown. The writer throws this error (code `ATOMIC_WRITE_UNSYNCED`, `path`, `cause`) instead of reporting success; the content is NOT rolled back, and a retry is harmless because the write is idempotent. Same stance as `storage-json` after commit `b130ccfbfb`.
- Not covered: parent directories created by this call's `mkdir` are not synced up the chain; owner-only permissions on Windows (a credentials-local DACL matter, see `16aa8c686a`); the README "Atomic, not durable" bullet and Dev Note in `packages/util/atomic-write/README.md` are outside this brief's paths and still describe the old behaviour.
- `packages/credentials/credentials-local/src/index.ts:modifyRecord` - persists through `writeFileAtomic`, so it now gets the file and directory sync with no change; it should surface `ATOMIC_WRITE_UNSYNCED` as a save failure it already treats any write error as.

## Lock records name their host and PID namespace (finding 137)

- `packages/util/atomic-write/src/index.ts:withFileLock` - the lock record is `<pid> <hostId>\n`. `hostId` is the hostname plus, on Linux, the `/proc/self/ns/pid` link, so two containers or hosts sharing a volume write different ids even when a PID number collides.
- `packages/util/atomic-write/src/index.ts:holderExited` - a PID probe only proves anything on the host that wrote the record. A record whose `hostId` differs from this process's is never reported as exited, so a live remote holder keeps its lock and a contender times out (`FILE_LOCK_TIMEOUT`) instead of stealing it; an operator removes a lock whose remote holder crashed. A legacy `<pid>\n` record has no id and is still probed locally, because refusing it would strand locks written before the upgrade.
- `packages/util/atomic-write/src/index.ts:localHostId` - computed once per process; a missing `/proc` leaves only the hostname, which still separates hosts but not PID namespaces on one host that share a hostname.
