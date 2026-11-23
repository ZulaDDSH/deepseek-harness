# ssh code notes

`packages/ssh/ssh/src/schemas.ts:editSchema` (finding 23, issue #126): the strict edit schema gains optional `append`, which the helper's `fs.edit` handler forwards unchanged to the helper-side `ctx.fs.editText`. `fs-ssh` forwards `FsEditRequest` as-is, so no `fs-ssh` code changes. A helper built before this change fails an append with its strict-schema error, which is the intended fail-closed behaviour for a version mismatch.
