# Memorix for DSH Desktop

This helper installs the DSH-tested Memorix pin into the existing Desktop profile and enables it through the built-in MCP client.

## Prerequisites

1. Install this repository's dependencies.
2. Launch DSH Desktop once so `$DSH_HOME/profiles/desktop` exists.
3. Stop DSH Desktop before changing its profile.

## Install

From the repository root:

```sh
node scripts/setup-memorix-desktop.mjs
```

The helper runs `pnpm add --save-exact --ignore-scripts memorix@1.3.0` inside the Desktop profile, verifies the installed CLI path, and appends one `memory-memorix` Cordis entry if it is not already present. Memorix's optional native packages are not built because this integration pins its SQLite backend to Node's built-in `node:sqlite`.

The generated Desktop-only MCP entry launches Memorix with Electron's Node mode instead of relying on a system `node` executable. It explicitly selects Memorix's `micro` MCP profile so only the compact core tool set enters model context and sets `MEMORIX_SQLITE_DRIVER=node` for a native-addon-free local database path. Memorix starts from the DSH Host working directory and can defer project binding when that directory is not a Git project; in that case the agent must call `memorix_session_start` with the active workspace path before project-scoped memory operations. Storage remains at Memorix's normal local location.

Restart DSH Desktop after setup. The memory tools appear with the `mcp__memorix__` prefix after MCP discovery completes.

## Validate

Use two separate DSH sessions in the same project:

1. Ask session A to remember a unique value and confirm a Memorix write tool runs.
2. Open session B and ask it to recall that value from memory.
3. Confirm session B uses the recalled value in a follow-up answer.

This setup does not make memory authoritative evidence. GARDEN task state and verified evidence should remain separate from Memorix experience memory.
