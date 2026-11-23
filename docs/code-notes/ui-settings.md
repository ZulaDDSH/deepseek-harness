# ui-settings code notes

## packages/client/ui-settings/src/client/config-form.ts:ConfigFormController.mutate

Finding 279. A thrown `remote.settings.mutate` (for example Gateway has no Connection at assembly time) skipped the returned-failure branch, so an accepted superseded write that only stored `pendingRevision` was never published and the mirror kept the pre-write value. The call is now wrapped: a throw is treated as an uncertain refused write, runs the same latest-write recovery read, and resolves `false` like a returned refusal. Callers and the save-status tracker already read `false` as failed, and no detached chain is left holding a rejection.

## packages/client/ui-settings/src/client/settings-mirror.ts:SettingsDescribeMirror.acceptView

Finding 278. A write answer used to replace the namespace row unconditionally, so a delayed answer at revision N landing after a describe had already published N+1 regressed the shown value and the fence revision. Revisions are Host-process counters that restart from 0, so a lower revision cannot be rejected outright as old: the mirror instead refuses to fold a lower-revision answer into a held row and runs a describe read, which settles out-of-order replies, newer completed reads and a restarted Host alike from the authoritative document. Equal or higher revisions fold in as before.
