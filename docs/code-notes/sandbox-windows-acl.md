# sandbox-windows-acl code notes

## NULL-DACL targets are refused (finding 37)

- `packages/sandbox/sandbox-windows-acl/src/acl.ts:grantWrite` - GetNamedSecurityInfoW returns a NULL DACL pointer for a directory that grants "everyone full control". Merging the grant into that null builds a brand-new DACL, and `revokeWrite` can never put the NULL DACL back (it leaves the world deny plus nothing else, which denies everything). Since the original cannot be restored, `grantWrite` refuses a NULL-DACL directory before any change and frees the descriptor it read. The operator repairs the directory (gives it an explicit DACL) and re-runs.
- `packages/sandbox/sandbox-windows-acl/src/acl.ts:revokeWrite` - unchanged: a NULL DACL still reports "nothing to revoke", which is correct because no grant could have been installed on it.
