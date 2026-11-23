# ui-provider-quota code notes

`packages/client/ui-provider-quota/src/client/ProviderQuotaAction.tsx:WINDOWS`: the popover draws only the window ids listed here, in this order, so a new `QuotaWindowId` must be added here and to the `window.<id>` and `span.<id>` strings in `locales.ts:zh` and `locales.ts:en`. `daily` reads "Today" and sits after `5h`.

`packages/client/ui-provider-quota/src/client/usage-prompt.ts:WINDOW_HOURS`: the table is typed `Record<QuotaWindowId, number>` and its keys are also the list of windows `usagePrompt` scans, so `daily` is 24 hours. Its only use there is ranking: when several windows are near their limit the longest is shown first, so a near-limit `daily` window yields to a weekly or monthly one. A provider without a billing switch (Freebuff) gets the plain near-limit or hard-limit text and "pick another model", not an offer to switch to API credits.
