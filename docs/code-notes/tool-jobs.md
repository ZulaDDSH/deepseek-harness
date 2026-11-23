# tool-jobs code notes

## packages/jobs/tool-jobs/src/index.ts:apply (issue 25)

At settlement a small stream used to be taken with the registry's consuming read before it was known whether the complete notice fits. A notice that did not fit kept the text in plugin memory as `held` for `job_output`, so a plugin reload dropped output the registry had already marked delivered and `job_output` then read `(no new output)`. A teardown effect that re-injected the held text patched this, but only for owners still registered.

The registry now offers `JobRegistry::peek` (`packages/jobs/jobs/src/index.ts`), a read that returns exactly what `read` would return but moves no cursor, spends no one-shot result and trims nothing. `deliverSettlement` builds the inline candidate from `peek` and takes the consuming `read` only when `inlineCompletionNotice` accepts it. A notice that does not fit therefore leaves every byte and the result in the registry, where `job_output` (and a reloaded plugin) finds them; `held` exists only on an inline notice, whose text already rides in the inbox message. The teardown workaround is removed because no unlogged state needs rescuing any more.

## packages/jobs/jobs-local/src/index.ts:LocalJobRegistry::peek (issue 25)

`peek` shares `readJob`'s projection but skips its three side effects: advancing `modelCursor`, setting `resultDelivered`, and trimming the settled ring. The result is reported while it is still undelivered, matching what the next `read` hands out.
