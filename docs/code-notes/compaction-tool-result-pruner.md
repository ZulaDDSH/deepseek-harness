# Compaction tool-result pruner code notes

`packages/compaction/compaction-tool-result-pruner/src/config.ts:codePointLength` counts code points by scanning UTF-16 units without materializing an array, so measuring a large tool result against the threshold allocates nothing proportional to its size. A lone surrogate still counts as one code point, matching the earlier `Array.from` count.

`packages/compaction/compaction-tool-result-pruner/src/config.ts:codePointOffset` maps a code-point index to its UTF-16 offset by scanning, and `packages/compaction/compaction-tool-result-pruner/src/index.ts:ToolResultPruner.pruneContent` slices the retained head and tail by those offsets instead of building a code-point array per block. Work stays linear in the input but extra memory is bounded by the retained text.

`packages/compaction/compaction-tool-result-pruner/src/index.ts:ToolResultPruner.pruneSession` measures each candidate once and passes the measured count to the pruning step, so reporting no longer recounts the original content.
