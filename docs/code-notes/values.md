# Values code notes

`packages/util/values/src/index.ts:deepEqualJson` requires each left-hand key to be an own property of the right-hand object. The earlier `key in right` test accepted inherited names, so a parsed `{"__proto__":{}}` compared equal to `{"x":1}` because both have one own key and the inherited prototype object compares as an empty object.

`packages/util/values/src/index.ts:normalizeLiveToolDetail` collapses whitespace over a bounded prefix of the text (`LIVE_TOOL_DETAIL_SCAN_CHARS` code units of normalized output) and segments only that prefix, so a short status label costs work proportional to the label rather than to the whole argument. When the scan stops early the result is always cut and ends in an ellipsis. A pathological prefix of combining marks can yield fewer than 159 graphemes before the ellipsis.

`packages/util/values/src/index.ts:liveToolDetail` remembers the last `(name, argsRaw)` pair and its detail, so repeated status recomputation over an unchanged streamed argument does not parse it again. A changed argument still parses in full once because JSON parsing cannot stop early.
