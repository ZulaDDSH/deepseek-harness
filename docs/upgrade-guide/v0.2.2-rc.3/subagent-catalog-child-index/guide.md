---
kind: upgrade-guide
description: "The cached subagentCatalog projection row is stamped state version 8, so cached version-7 rows are discarded and refolded once per parent Session."
---

# Subagent catalog projection state version 8

## Change

The `subagentCatalog` projection state now carries a keyed index of each child and of the names its creator has used, beside the ordered child list. Creating a named or unnamed subagent, and resolving a creator's ancestry, read that index instead of scanning every earlier child, so their cost no longer grows with the number of children a parent has accumulated. The `subagent/catalog` event payload, the Session log, and the client catalog view do not change.

The cached projection row for a parent Session is stamped `ver: 8`. A cached row stamped `ver: 7` has no index, so the first read of that Session after upgrading discards the row and refolds the parent's log once, then writes a `ver: 8` row. A DSH binary from before this release treats a `ver: 8` row the same way and refolds it. No log is rewritten and no child is lost in either direction.

## Migration

1. No action is required; upgrade every DSH binary that shares the same `DSH_HOME` at your convenience. Mixed versions only cost a refold per read of a large parent Session.
2. Expect one slower first open of each parent Session that has many children. Later reads and every creation use the cached row.
3. Confirm by creating a subagent in a parent Session that existed before the upgrade and checking that its `subagentCatalog` cache row in the projection cache now reads `ver: 8`.
