# Connect a third-party memory MCP server

These three **default-off reference configurations** connect one memory system to DSH through [`@deepseek-ai/dsh-mcp-client`](../../../packages/mcp/mcp-client/README.md). Pick one, or copy the same generic MCP row for another server.

These third-party configurations are provided as interoperability examples only. Their inclusion does not imply endorsement, recommendation, partnership, or ongoing support by DeepSeek.

## What DSH does

DSH parses the selected Cordis overlay, starts a configured stdio command or connects to a configured Streamable HTTP URL, discovers MCP tools, and exposes them as `mcp__<serverName>__<tool>`. DSH does **not** download the server (the web composition ships its own Memorix build, described below), initialize its database, choose its model or embedding provider, create a cloud account, migrate vendor data, or supervise a separate HTTP service. For stdio, the generic client launches and stops the child with the DSH plugin lifecycle; for HTTP, the upstream service must already be running.

The stdio bridge deliberately removes ambient variables whose names usually identify credentials and all `DSH_*` variables before launching a child; other ambient variables remain inherited. Each example adds only the baseline override it needs. If an optional upstream feature needs another secret, add that variable to the row's `config.env` instead of putting the secret directly in YAML.

## Choose one

| System | Tested pin | Transport | Upstream prerequisite |
|---|---:|---|---|
| [Memorix](https://github.com/AVIDS2/memorix) | `memorix@1.9.10` | stdio | None for the web composition, which ships it; Node 22.18+ and `npm install --global memorix@1.9.10` only to run your own copy |
| [MCP Reference Memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | `@modelcontextprotocol/server-memory@2026.7.4` (`6dd0a683e198783e30feabf7abaf42f925bd18b1`) | stdio | `npm install --global @modelcontextprotocol/server-memory@2026.7.4` |
| [Engram](https://github.com/Gentleman-Programming/engram) | `v1.20.0` (`ba9e46ced152c37a7cb9e576153c41995873e2fc`) | stdio | Go 1.25.10+ and `go install github.com/Gentleman-Programming/engram/cmd/engram@v1.20.0`, or the matching release binary |

## Enable one

Pass one overlay to DSH:

```sh
dsh web --patch "$PWD/apps/cli/config/examples/mcp-memory/memorix.cordis.yml"
```

Replace the filename with `mcp-reference-memory.cordis.yml` or `engram.cordis.yml`. The path may point to a copied file anywhere on disk. No memory server is present in the shipped composition, so omitting `--patch` keeps all three disabled.

To keep the selection across runs, merge the chosen file's single `insert` patch into a user patch layer — `$DSH_HOME/profiles/<name>/cordis.patch.yml` for one profile, or `$DSH_HOME/cordis.patch.yml` for every profile on the machine. Do not copy over an existing file: it may already contain unrelated user patches.

## Provider setup

### Memorix

The web composition (the desktop app and `dsh web`) ships Memorix 1.9.10 as a pinned dependency and starts it with the Host, so there is nothing to install. The `memory-memorix` row runs the packaged Memorix command-line entry under the same Node that runs DSH, with `MEMORIX_SQLITE_DRIVER=node`, so it needs no global install, no `PATH` lookup and no native SQLite build. Memorix's optional vector index (LanceDB) and native SQLite binding are not shipped; Memorix keeps its keyword search without them.

To run your own Memorix instead, install it and pass the overlay, which replaces the shipped `memory-memorix` row:

```sh
npm install --global memorix@1.9.10
dsh web --patch "$PWD/apps/cli/config/examples/mcp-memory/memorix.cordis.yml"
```

If you already have a Memorix database from an older version (such as 1.3.0), opening it with Memorix 1.9.10 may upgrade it in place, and the upgrade cannot be undone. Before the shipped Memorix first starts, DSH copies an existing `memorix.db` (and its `-wal` and `-shm` files) once to `memorix.db.dsh-pre-1.9.10.bak` in the same folder, and never overwrites that copy. Keep your own backup of the `.memorix` folder in your home directory (or your `MEMORIX_DATA_DIR`) as well. The Memory page reads databases written by Memorix 1.3.0 and later, but it never changes them.

Memorix works in local heuristic mode without an LLM or embedding service. Configure optional providers in Memorix's own `~/.memorix/config.toml` or project `memorix.toml`. It uses its own `~/.memorix/data` default; set `MEMORIX_DATA_DIR` before starting DSH to override it. Memory is saved per project. A workspace inside a Git repository uses that project, except that a repository at your home folder does not count. Any other folder, including one that only contains repositories, gets its own project: DSH keeps an empty Git repository for it under `$DSH_HOME/memorix-roots` (default `~/.dsh/memorix-roots`), created without running `git`, and never writes into the folder itself. Documents you upload on the Memory page are saved in one shared `documents` project there; a file imported from a chat is saved in that chat's workspace project. Notes saved before a folder became a Git repository stay under its earlier project, so they are not recalled after that change.

### Memory page and chat memory (Memorix)

The shipped web composition enables `ui-memory-workspace` beside the Memorix client above. It gives you the **Memory** page and makes agents use Memorix without being asked. The page reads `memorix.db` from the `MEMORIX_DATA_DIR` in that client's `env`, or `~/.memorix/data` by default; set `databasePath` on the `ui-memory-workspace` row if the file is elsewhere or the client is remote. Memorix creates the file when the first memory is stored, so a brand-new install reports "Memorix database not found" until then. Every panel error names the setting to change.

The **Memory** page has a chat memory section. It shows whether chat memory is on, whether Memorix is ready, still being set up, or failed to start (with the error and a **Retry** button when it failed), the time of the last successful save and recall, and the latest save or recall failure with its time.

Chat memory is on by default. Turn it off or on in **Settings**, row **Memory: save chats and recall them** (`记忆：保存聊天并回忆` in Chinese); the change applies without a restart.

```yaml
- id: ui-memory-workspace
  disabled: false
  config:
    chatMemory: true        # Settings toggle; saves and recall both follow it (default true)
    autoSave: true          # save each finished turn as its own observation (default true)
    recall: true            # search memory for the first message of a session (default true)
    policy: true            # tell the agent when to search and store memory
    memoryCharacters: 3000  # size limit of one saved turn and of recalled context
```

Each finished turn is saved as its own Memorix observation on the entity `dsh-workspace:<folder>-<hash>`, with topic key `dsh-session:<session>:<segment>:turn:<n>`, so `memorix_search` finds it and the page lists it under **Saved memories**. A turn record holds the user request and the final answer only, is clipped to `memoryCharacters`, drops obvious secrets, and never includes tool output. Compaction summaries are saved as checkpoints. Subagent and interrupted turns are not saved, and CLI terminal sessions are excluded from saves and recall. Saving never fails a turn.

When a session's first user message arrives, DSH searches Memorix for it (scope `project`, status `active`) and adds the best matches to that session's context before the first model step. The notes are labelled as possibly stale, and the search gets a 3 second budget. If the search fails, times out, or finds nothing, DSH adds the three newest notes from earlier chats in the same workspace instead. The Memory page shows the last recall failure. Set `recall: false` to stop recall, or `policy: false` to remove the policy section.

Failures never interrupt a turn. The first occurrence of each distinct failure is logged at warning level as `memory-workspace: automatic memory save failed: ...` or `memory-workspace: automatic memory recall failed: ...`; repeats log at info level. When the plugin is disposed, DSH waits up to five seconds for queued saves.

### MCP Reference Memory

```sh
npm install --global @modelcontextprotocol/server-memory@2026.7.4
dsh web --patch "$PWD/apps/cli/config/examples/mcp-memory/mcp-reference-memory.cordis.yml"
```

This reference server stores a local knowledge graph and exposes entity, relation, observation, read, search, and open tools. It needs no model or embedding service. The example stores its JSONL at `$HOME/.dsh-mcp-reference-memory.jsonl` instead of the installed npm package directory. Set `MEMORY_FILE_PATH` before starting DSH to override it.

Search is case-insensitive substring matching over entity names, types, and observations, not semantic retrieval. The server does not add embeddings, automatic summarization, conflict resolution, or a forgetting policy.

### Engram

```sh
go install github.com/Gentleman-Programming/engram/cmd/engram@v1.20.0
dsh web --patch "$PWD/apps/cli/config/examples/mcp-memory/engram.cordis.yml"
```

Engram owns storage and project selection: it uses `~/.engram` by default, detects the Git project from the DSH working directory, and accepts `ENGRAM_DATA_DIR` or `ENGRAM_PROJECT` as ambient overrides.

## Optional shared model instruction

Add this short, vendor-neutral instruction to your existing model instructions if the server's tool descriptions do not trigger memory use reliably:

> When the user asks you to remember something, call a memory write tool. When historical information may be relevant, search memory and use relevant results.

This is additive guidance only. The examples do not replace DSH's system-prompt persona.

## Verify write, fresh-session recall, and use

Use one unique value and keep the provider's storage scope unchanged throughout:

1. In DSH session A, ask: `Remember that my validation drink is lapsang-<unique suffix>.` Confirm the model called the provider's write tool and the tool returned success.
2. Create DSH session B in the same running Host. Do not copy session A's conversation. Ask: `What is my validation drink? Check memory.` Confirm the model called the provider's search or recall tool and returned the value.
3. Still in session B, ask: `Use that preference to suggest one drink for the meeting.` Confirm the answer uses the recalled value.

A new DSH session is required; a Host restart is not. A crashed MCP child triggers automatic reconnection with backoff and a tool re-sync; tools stay listed and calls fail only during the outage, and after the reconnect budget is exhausted the tools are unregistered and reconnection stops until a reload or restart. Initial discovery is asynchronous, so wait for the provider's `mcp__...` tools before sending the first validation prompt.

## Bring another MCP server

Copy the same entry fields and use a unique `id` and `serverName`:

```yaml
- insert:
    - id: memory-my-server
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: my-memory
        transport: stdio
        command: my-memory-mcp
        args: []
        env: {}
        cwd: !!js process.cwd()
```

For a remote server, use `transport: streamable-http`, `url`, and `headers` instead. Provider-specific installation, identity, authentication, models, embeddings, persistence, and licensing remain the provider's responsibility.
