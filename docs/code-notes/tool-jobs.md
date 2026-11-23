# tool-jobs code notes

## packages/jobs/tool-jobs/src/index.ts:apply (issue 25)

At settlement a small stream is taken with the registry's consuming read, so its cursor and one-shot result are spent before the model sees them. When the complete notice does not fit (`PendingNotice.inline` false) the text stays in plugin memory as `held` for `job_output`. A plugin reload dropped that memory, so `job_output` then read `(no new output)`. The registry (`packages/jobs/jobs`) has no way to un-read or defer a commit, so the held read is made recoverable instead: the plugin's teardown effect swaps the unlogged or pointer-only notice for a notice that carries the held text, injected into the owner's inbox. An inline notice already carries its text in the inbox message and needs nothing. The owner is not woken (inject), matching a notice reaching a busy owner; an owner already disposed has no inbox to receive it.
