# ui-theme code notes

## packages/client/ui-theme/src/client/index.ts:ThemeRuntime.write

Finding 290. `write` detached `operation().finally(...)`; the save-status tracker consumed the original write promise's rejection but the promise returned by `.finally()` re-rejected with nothing attached, so a rejected Host write raised an unhandled rejection. The detached chain now converts a rejection to a refusal before `.finally`, which still decrements `pendingWrites` and adopts the held section so the optimistic value reverts.

## packages/client/ui-theme/src/client/FontFamilyRow.tsx:FontFamilyRow

Finding 289. The input was remounted whenever the saved value (its React key) changed, so a concurrent change from another browser discarded an in-progress draft and focus. The key is now pinned to the value seen when editing began while the field is focused, so incoming saved values wait until blur. Blur commits only a changed field, so a field the user did not edit cannot write its stale text over the newer saved value; an edited field still saves on blur and wins over the concurrent change (last writer wins, no conflict prompt: product decision for the lead).
