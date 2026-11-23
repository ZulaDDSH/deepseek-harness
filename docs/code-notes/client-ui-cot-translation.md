# client-ui-cot-translation code notes

## packages/experimental/client-ui-cot-translation/src/client/locales.ts:pt (issue 165)

The Portuguese dictionary labelled both `google` and `bing` as `Google`, so the default Bing option read as Google in the privacy-relevant provider dropdown. `bing` now reads `Bing`. `tests/locales.client.spec.ts` checks every dictionary names the two services distinctly (and, outside the Cyrillic transliteration in `ru`, with their own names).
