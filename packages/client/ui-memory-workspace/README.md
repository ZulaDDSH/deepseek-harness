---
description: "Local Memorix browsing, document imports and Graphify context graphs."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-memory-workspace

English | [中文](README.zh.md)

## Summary

The Memory sidebar panel browses the local Memorix store, imports documents through the connected provider, and displays Graphify’s own generated HTML viewer. It is disabled in the shipped Web composition until explicitly enabled.

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

Select **Memory** to browse every provider table, search all columns and inspect complete records. The local view includes all projects, statuses and visibility scopes; it does not forward those records to a model. Uploading TXT, Markdown, CSV, JSON, logs, PDF or Office documents retains the original file and writes every extracted text chunk through `memorix_store`. Each chunk is read back using the provider-acknowledged observation and project before success is reported. Partial imports preserve completed chunks and can be retried using stable document identifiers.

The **Context graph** tab rebuilds complete active document imports from the connected Memorix database whenever opened or refreshed. Configure `graphifyCommand` as Graphify's Python interpreter and `graphifyArgs` with `scripts/graphify-native.py`. The adapter reconstructs saved text and invokes Graphify's own Markdown extractor, builder, community detector, structural labels and HTML exporter, without model calls or scanning Harness code. Headings and explicit links are structural evidence; conceptual inference is not performed. Partial and archived imports are excluded. Output uses `graphPath`, or `graphify-out/graph.json` beneath `importDirectory`. The native viewer retains its community filters, layout, search and node details in a script-only sandbox; its pinned visualization library loads from unpkg. Older installed Hosts can use the adapter prefix `--memorix-database <database>` before their HTML export command. Knowledge Router's `/graphify` commands continue to use the calling chat's workspace graph.

-----

## Understand the implementation

`src/index.ts:MemoryWorkspace` owns authenticated Host RPC methods, upload retention and provider-confirmed imports. `src/client/MemoryPage.tsx:MemoryPage` owns browsing and graph interaction. [Knowledge Router](../../knowledge/knowledge-router/README.md) owns read-only SQLite access and native Graphify chat commands. [MCP Client](../../mcp/mcp-client/README.md) owns effect-scoped human access to the current connected provider.

No runtime invariant companion is published: displayed data derives from provider reads and no independent memory index is maintained.

-----

## Further Exploration

- [Memory MCP configuration](../../../docs/user/guide/mcp-memory.md)
- [Client packages](../README.md)

## Model Experience

### Document import tool

#### What the model sees

With the tool registry and filesystem mounted, agents can call `memorix_import_file` with an absolute path or a path relative to their chat workspace. It uses the same bounded, provider-verified importer as the panel and returns retained-file and chunk counts, including partial failures. For example, ask: “Import docs/guide.pdf into Memorix using memorix_import_file.” Existing Memorix tools retrieve imported memories; the panel adds no automatic memory injection.

#### Token effect

The tool schema and provider-confirmed import result consume request and transcript tokens. Imported document contents are not automatically injected into later requests.

#### KV Cache effect

Memorix provider configuration owns subsequent retrieval and its request effects.

## Known Limitations and Deferred Work

- Only the Memorix 1.3.0 migration inventory is supported; unsupported databases fail explicitly and are never migrated. Uploads accept UTF-8 text, PDF text layers and Office documents through the existing Office conversion provider. Scanned documents require OCR; this panel does not perform OCR. Byte and extracted-character limits reject oversized documents without truncation.
- Graphify and the supplied adapter must be installed. The derived graph rebuilds when opened or refreshed; uploads remain successful if later graph generation fails. Local browsing includes private and team records owned by the local user and is intended for an authenticated personal Host.

<a id="dev-note"></a>
### Dev Note

None.
