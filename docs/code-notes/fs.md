# fs code notes

`packages/fs/fs/src/types.ts:FsEditRequest` (finding 23, issue #126): the request gains optional `append`. When true, `oldString` must be empty and `newString` is added at the end of the current content; `replaceAll` is ignored. Providers that cannot append must reject the request rather than treat it as a replacement; the optional field keeps older callers and serialized requests valid. The ssh helper protocol carries the field through its edit schema, so a remote runtime built before this change rejects an append with its strict-schema error instead of misreading it.
