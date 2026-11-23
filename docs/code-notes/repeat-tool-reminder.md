# Repeat tool reminder code notes

`packages/guard/repeat-tool-reminder/src/index.ts:sortJsonValue` copies parsed JSON into null-prototype objects with own-property definitions, so an own `__proto__` argument key survives canonicalization instead of invoking the inherited prototype setter. It walks no deeper than the `MAX_CANONICAL_DEPTH` limit and throws `CanonicalDepthExceeded` beyond it, because recursive copying or stringifying a very deep argument would exhaust the call stack inside `tools/post-execute` after the tool body already ran.

`packages/guard/repeat-tool-reminder/src/index.ts:apply` contains every detection failure. When canonicalization is skipped (depth limit or any thrown error) the agent's chain is deleted and no reminder is produced, so an unknown comparison never counts as a repeat and a completed tool result is never replaced by a guard error.
