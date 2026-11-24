---
kind: upgrade-guide
description: "Web, Desktop, headless and SDK profiles now run tools through the PTC executor, so models see only run_code; the native executor is an explicit overlay."
---

# Profiles use the PTC executor by default

## Change

The `dsh-base` bundle now enables `tool-executor-ptc` and ships `tool-executor-native` with `disabled: true`. Every base-backed profile (`web`, `desktop`, `headless`, `sdk`) and every Web preset without its own executor row (`standard`, `cordis`, `lean`, `master`, `minimal`) sends the model one `run_code` tool plus a generated TypeScript SDK. The model reaches `bash`, file, subagent, web and other tools as `tools.<name>(...)` calls inside the program. Each nested call still passes approvals, hooks, guards and sandbox policy, and appears in the Session as a `tool/ptc-dispatch` event.

A program stops after 120 seconds by default (600 seconds at most), including approval and nested tool waits. Recorded sessions, expected outputs and mock models that call a tool such as `bash` directly now receive `UNKNOWN_TOOL`; replace direct calls with `run_code` or select native execution.

Two surfaces stay native: the `acp` profile, whose updates carry only top-level `tool/call` events and would leave nested permission requests unannounced, and `sdk-minimal`, which mounts no PTC runtime. The Web `ptc` preset is unchanged and keeps its own executor row.

A user patch that enables `tool-executor-native` without disabling `tool-executor-ptc` now fails startup, because one scope allows one executor.

## Migration

1. To keep native execution for a profile, pass [`apps/cli/config/examples/native.yml`](../../../../apps/cli/config/examples/native.yml) with `--patch` (or `patches` in the TypeScript and Python SDKs), or add both rows to the profile's `cordis.patch.yml`:

   ```yaml
   - id: tool-executor-ptc
     disabled: true
   - id: tool-executor-native
     disabled: false
   ```

2. To keep native execution for one Web preset only, add a `tool-executor-native` row (`name: '@deepseek-ai/dsh-tool-executor-native'`) to that preset's `plugins` in the preset editor or its patch.
3. If a patch enables both rows, disable `tool-executor-ptc` as above or remove the native row.
4. Drop `--patch .../ptc.yml` unless you want its `apply_patch: false` tool set; PTC is already selected without it.
5. Move long-running commands into background jobs or raise `timeoutMs` on `run_code` up to 600000.
6. Run a task and confirm the model request lists only `run_code`; with the native overlay it lists each tool schema.
