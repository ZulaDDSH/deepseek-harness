# storage-sqlite code notes

## One process owns a database file (finding 139)

- `packages/storage/storage-sqlite/src/schema.ts:configureDatabase` - the domain layer caches records in memory and upserts them without a revision check, so two Hosts on one file would overwrite each other from stale memory. A file database now opens with `PRAGMA locking_mode = EXCLUSIVE` (set before the journal mode so WAL needs no shared memory) and takes the lock immediately with an empty `BEGIN IMMEDIATE; COMMIT`; the lock then lasts until the connection closes. A second connection, in another process or another backend object, fails to open with `StorageError` code `locked` (SQLITE_BUSY maps to it) instead of silently sharing the file. `:memory:` is exempt. This enforces the single-owner choice; cross-Host sharing would need revisioned conditional writes in `KvUnit`, which this does not add.
- Side effect: external readers (the `sqlite3` CLI, backup tools) cannot open the file while the Host runs.
- `packages/storage/storage-sqlite/src/index.ts:Config` - `exclusive` (default true) turns the lock off for operators who need concurrent external readers; tests that inspect the file through a side connection construct the backend with `exclusive: false`.
