# office-kit code notes

## Release fences saves (finding 83)

- `packages/document/office-kit/src/outputs.ts:OutputStore::save` - every save registers a ticket naming its owner when it is called. `release(owner)` marks every ticket of that owner released at once and then waits for those saves to settle. A save whose ticket is released, or whose caller signal aborted, deletes the file it wrote and rejects instead of leaving an entry after the owner's release. A save called after the release gets a fresh ticket, so a later Session that reuses the owner id keeps its outputs.
- `packages/document/office-kit/src/outputs.ts:OutputStore::saveNow` - the ticket is checked before the write (a queued save for a released owner writes nothing) and again after it (a save paused inside the write). The caller's signal is passed down for the same two checks.
- `packages/document/office-kit/src/index.ts:OfficeKitProvider::saveFile` - passes the caller's cancellation signal to the store.
- Not covered: a conversion still running in the queue when the owner is released that calls `save` afterwards is a new generation by this rule; the caller's own signal (aborted by Session disposal) is what stops it.

## Parsing runs in a kit helper, not in the Host process (finding 81)

- `packages/document/office-kit/src/index.ts:OfficeKit::runOperation` - checked `@deepseek-ai/libreoffice-kit` 0.2.3 (`lib/index.js` `spawn` near line 442, `new Worker(new URL("./worker.js"...))` near line 2011; its README "Each converter serializes renders. A render creates a separate native process or Node worker and private profile"). Native engines (Windows, macOS) parse in a disposable helper child process; the WASM engine (Linux) parses in a Node Worker. So the earlier wording "inside the Host process" was wrong: no document parser is loaded into the Host's own address space.
- Bounds already enforced for every parse: `timeoutMs` (deadline in the helper, killed on expiry), `maxInputBytes` and the `maxSourceBytes` reservation (checked before the bytes are read), `maxOutputBytes`, and for OOXML `maxArchiveEntries` and `maxUncompressedBytes`; `tests/provider.spec.ts` "passes configured limits to the kit" proves the provider forwards them.
- Remaining limit, not fixable in this package: the helper inherits the Host's token and Job restrictions (the kit documents "inherit the caller's token and Job restrictions"), so it is not filesystem- or network-confined, and the kit exposes no memory cap or spawn wrapper. Legacy binary `.doc`/`.xls`/`.ppt` have no entry or decompression caps (only the size and time bounds). Confining the helper needs a spawn-wrapper or restricted-token option in the kit.
