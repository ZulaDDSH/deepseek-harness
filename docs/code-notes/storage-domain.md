# storage-domain code notes

## Single-Host ownership of a domain medium (finding 139)

- `packages/storage/storage-domain/src/domain.ts:KvTableImpl::put` - writes the cached value through `KvUnit.putRecord` with no expected revision, and `DomainImpl` serves reads from its in-memory maps, so a second process sharing the medium is neither observed nor protected. The `KvUnit` contract (`packages/storage/storage/src/backend.ts`) has no conditional write or re-read-one-record primitive, and the owner lock for SQLite (for example `PRAGMA locking_mode=EXCLUSIVE` in `packages/storage/storage-sqlite/src/schema.ts:openDatabase`) lives outside this package, so the domain layer only documents the one-Host-per-medium requirement in its README.
