---
description: "Local Memorix browsing, document imports and Graphify context graphs."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-memory-workspace

## Summary

The Memory sidebar panel browses the local Memorix store, imports documents through the connected provider, and displays Graphify’s own generated HTML viewer. The shipped Web composition enables it beside the `memory-memorix` MCP client, and it saves finished chat turns to Memorix and recalls them in later chats.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Enable the `ui-memory-workspace` row beside a configured Memorix MCP client. `memorixServer` defaults to `memorix`. Browsing derives the database path from that client's explicit `MEMORIX_DATA_DIR`, or Memorix's `~/.memorix/data` default. `databasePath` overrides it; remote MCP providers require an explicit local path.

Select **Memory** to browse every provider table, search all columns and inspect complete records. Records list newest first, so recent agent memories are not buried under imported document chunks; on tables with a topic key, the **All records / Saved memories / Imported documents** filter separates them. Search applies after a short pause or on Enter, and the detail pane shows every field. When Memorix is missing, disconnected or unreadable, the panel shows the exact setting to change (the missing `dsh-mcp-client` row, its connection state, `MEMORIX_DATA_DIR`, `databasePath`, `graphifyCommand` or `graphifyArgs`). Configuration guidance appears only when the store itself cannot be read; Graphify and upload failures show their own messages beside the tab or the upload control. The local view includes all projects, statuses and visibility scopes; it does not forward those records to a model. Uploading TXT, Markdown, CSV, JSON, logs, PDF or Office documents retains the original file and writes every extracted text chunk through `memorix_store`. Each chunk is read back using the provider-acknowledged observation and project before success is reported. Partial imports preserve completed chunks and can be retried using stable document identifiers.

The **Context graph** tab rebuilds complete active document imports from the connected Memorix database whenever opened or refreshed. While no document has been imported, the tab shows the upload hint and does not run Graphify. Configure `graphifyCommand` as Graphify's Python interpreter and `graphifyArgs` with `scripts/graphify-native.py`. The adapter reconstructs saved text and invokes Graphify's own Markdown extractor, builder, community detector, structural labels and HTML exporter, without model calls or scanning Harness code. Headings and explicit links are structural evidence; conceptual inference is not performed. Partial and archived imports are excluded. Output uses `graphPath`, or `graphify-out/graph.json` beneath `importDirectory`. The native viewer retains its community filters, layout, search and node details in a script-only sandbox; its pinned visualization library loads from unpkg. Older installed Hosts can use the adapter prefix `--memorix-database <database>` before their HTML export command. Knowledge Router's `/graphify` commands continue to use the calling chat's workspace graph.

-----

### Automatic memory

When the Memorix store tool is visible to the model, three things happen without any model cooperation. Each has a switch in the `ui-memory-workspace` row, and the **Memory: save chats and recall them** Settings row switches saves and recall together:

| Setting | Default | Effect |
|---|---|---|
| `chatMemory` | `true` | Master switch for saves and recall. A volatile setting, so the Settings toggle takes effect without a restart. |
| `policy` | `true` | A `memory:policy` system-prompt section tells the agent to search memory before dependent work and to call the store tool for decisions, preferences, hidden project facts and verified outcomes. It is empty while the store tool is not visible. |
| `autoSave` | `true` | Each finished turn is written as its own observation through `memorix_store`, with topic key `dsh-session:<session>:<segment>:turn:<n>`. The record holds the user request and the final answer, clipped to `memoryCharacters` (default 3000), with provider tokens, GitHub PATs, Google API keys, AWS keys, PEM private keys, JWTs, URL credentials and assignments to secret-looking names redacted. Tool output is excluded. Compaction summaries are saved as checkpoints. Subagent and interrupted turns, and CLI terminal sessions, are skipped. |
| `recall` | `true` | On a session's first user message, `memorix_search` (scope `project`, status `active`) runs before the first model step within a 3 second budget. The best matches are added under `memory:recall` and labelled possibly stale. When the search fails, times out or finds nothing, the newest three notes from earlier chats in the workspace are used instead. |

Failures never interrupt a turn. Each failure is recorded with its time, and the Memory page shows the latest save or recall failure. The first occurrence of each distinct failure is logged at warning level as `memory-workspace: automatic memory save failed: ...` or `memory-workspace: automatic memory recall failed: ...`; repeats log at info level. Saves use entity `dsh-workspace:<folder>-<hash>`, so they are searchable with `memorix_search` and visible under **Saved memories**. The plugin waits up to five seconds for queued saves when it is disposed.

-----

## Understand the implementation

`src/automation.ts:MemoryAutomation` owns the policy section, digest saves and recall; `src/store.ts:storeObservation` is the single acknowledged-write path shared with imports. `src/index.ts:MemoryWorkspace` owns authenticated Host RPC methods, upload retention and provider-confirmed imports. `src/client/MemoryPage.tsx:MemoryPage` owns browsing and graph interaction. [Knowledge Router](../../knowledge/knowledge-router/README.md) owns read-only SQLite access and native Graphify chat commands. [MCP Client](../../mcp/mcp-client/README.md) owns effect-scoped human access to the current connected provider.

No runtime invariant companion is published: displayed data derives from provider reads and no independent memory index is maintained.

-----

## Further Exploration

- [Memory MCP configuration](../../../docs/user/guide/mcp-memory.md)
- [Client packages](../README.md)

## Model Experience

### Document import tool

#### What the model sees

With the tool registry and filesystem mounted, agents can call `memorix_import_file` with an absolute path or a path relative to their chat workspace. It uses the same bounded, provider-verified importer as the panel and returns retained-file and chunk counts, including partial failures. For example, ask: “Import docs/guide.pdf into Memorix using memorix_import_file.” Existing Memorix tools retrieve imported memories. Separately, the automatic memory policy and recall described above add bounded system-prompt text.

#### Token effect

The tool schema and provider-confirmed import result consume request and transcript tokens. Imported document contents are not automatically injected into later requests.

#### KV Cache effect

Memorix provider configuration owns subsequent retrieval and its request effects.

### Memory policy and recall

#### What the model sees

A short `memory:policy` section (about 200 tokens) in the system prompt while the Memorix store tool is visible, plus at most `memoryCharacters` of recalled notes under the `memory:recall` runtime context. Automatic saves are invisible to the model.

#### Token effect

The policy and recall text are added to every request of the session. Set `policy: false` or `recall: false` to remove them. Imported document contents are never injected automatically.

#### KV Cache effect

The policy section is constant while the Memorix store tool stays visible. It appears when the tool first becomes visible, which changes the system prompt once. Recall is computed once, before the session's first model step, and sits in runtime context after the stable prompt, so it stays fixed for the session. Provider retrieval keeps its own request effects.

## Known Limitations and Deferred Work

- Memorix 1.9.10 is the pinned version; the panel reads the tables that version creates and fails explicitly on a database missing a required migration. It never migrates a database. Uploads accept UTF-8 text, PDF text layers and Office documents through the existing Office conversion provider. Scanned documents require OCR; this panel does not perform OCR. Byte and extracted-character limits reject oversized documents without truncation.
- Automatic turn records rely on the model-facing store tool being registered; with only a remote Memorix provider they are acknowledged but cannot be read back, and recall only reads a local database. The web composition ships Memorix 1.9.10, so no install step exists; when the packaged server fails to start, the Memory page shows the error with a Retry button and chats run unchanged. Memorix binds a session to a Git project, so a workspace outside any Git repository is saved under an empty repository DSH keeps in `$DSH_HOME/memorix-roots`; document uploads use the `documents` project there.
- The Context graph's upload-hint check counts every document chunk, archived and partial imports included, so a store holding only those still runs Graphify (which then receives no active documents) instead of showing the hint.
- The digest secret scrub is pattern-based. It can over-redact assignments such as `max_tokens=4096`, and it can miss credential formats it does not list.
- `importDocument` declares a trailing `AbortSignal`, so the Client applies no unary deadline to an upload that is still extracting or importing. The upload panel passes no signal, so a slow import runs until it finishes or the Host lifetime ends, and the panel cannot cancel it.
- Graphify and the supplied adapter must be installed. The derived graph rebuilds when opened or refreshed; uploads remain successful if later graph generation fails. Local browsing includes private and team records owned by the local user and is intended for an authenticated personal Host.

<a id="dev-note"></a>
### Dev Note

None.
