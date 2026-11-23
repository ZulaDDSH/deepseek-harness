# sandbox-windows-acl code notes

## NULL-DACL targets are refused (finding 37)

- `packages/sandbox/sandbox-windows-acl/src/acl.ts:grantWrite` - GetNamedSecurityInfoW returns a NULL DACL pointer for a directory that grants "everyone full control". Merging the grant into that null builds a brand-new DACL, and `revokeWrite` can never put the NULL DACL back (it leaves the world deny plus nothing else, which denies everything). Since the original cannot be restored, `grantWrite` refuses a NULL-DACL directory before any change and frees the descriptor it read. The operator repairs the directory (gives it an explicit DACL) and re-runs.
- `packages/sandbox/sandbox-windows-acl/src/acl.ts:revokeWrite` - unchanged: a NULL DACL still reports "nothing to revoke", which is correct because no grant could have been installed on it.

## Restoring a standing workspace grant (finding 79)

- `packages/sandbox/sandbox-windows-acl/src/grant.ts:AclWriteGrant::restore` - the explicit, operator-invoked way to undo the standing workspace pair (capability ACE, ambient-delete deny, inheritable Low label) that `dispose()` deliberately keeps as the reuse cache. It derives nothing itself: the caller passes the same `workspaceWriteSid(root)` the grant used and the canonical root, and the call is `revokeWrite` under the path lock, so a label another capability grant still needs is kept and a NULL DACL is refused. `dispose()` itself is unchanged, because revoking per session would re-propagate the whole tree on every provision.
- Safe only when no confined process for that workspace is alive and no other Harness instance is about to provision it: the revoke is not coordinated with other server instances, and a running confined child loses write access immediately. The sandbox-local provider does not call it. Not covered: automatic crash recovery, tracking renamed workspaces, a read-only inspect call (use the diagnose script's report), and a restore of non-default pre-existing labels beyond what `revokeWrite` does.
