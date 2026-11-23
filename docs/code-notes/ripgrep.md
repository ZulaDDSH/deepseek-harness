# ripgrep code notes

## Undecodable records are counted (finding 133)

- `packages/util/ripgrep/src/index.ts:readRipgrepLines` - stdout was decoded as UTF-8 before splitting, so the bytes of a filename that is not valid UTF-8 silently became U+FFFD and the delivered string could name no real file or collide with another name. The reader now splits raw bytes (`\n` and NUL never occur inside a multi-byte UTF-8 sequence, so byte splitting is safe), decodes each record with a fatal `TextDecoder` (BOM kept), and on failure still delivers the replacement-decoded text so existing callers keep their behavior but counts the record. The result carries `undecodable` (omitted when zero) so a consumer can report that some names could not be represented instead of presenting a misleading path. A lossless representation (raw bytes through the filesystem and API layers) is not attempted here; `packages/api/workspace-files/src/search.ts` and the fs search tool must read `undecodable` to surface it.
