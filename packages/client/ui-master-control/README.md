---
description: "Master Control home, external text imports, and workspace session supervision in the web client."
kind: "package-reference"
---
# Master Control UI

## Summary

Master Control opens a dedicated supervising chat, imports Claude Code and Codex text histories into DSH, and groups the session roster by workspace. Search and status filters narrow the roster; rows open conversations or interrupt running work. The normal conversation UI owns continued chats.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The web bundle mounts this sidebar page above Plugins. Open master chat resolves the host's dedicated ungrouped home rather than selecting an arbitrary master-preset conversation. Roster groups use existing workspace membership, with Ungrouped for other sessions. The home is omitted from the worker roster.

Import chats lists recent local Claude Code and Codex transcripts. Preview and select rows, then import their supported user/assistant text. Each result reports success, an existing duplicate, or a failure; Open shows the imported conversation in the normal DSH UI. Imported chats use the standard preset and continue with DSH's agent and tools.

The [Session Controller](../../api/session-controller/README.md) owns discovery and durable import. [Master Control tools](../../subagent/tool-master-control/README.md) own agent messaging and interruption.

## Model Experience

### Imported conversation history

#### What the model sees

Supported imported text becomes ordinary `user/message` and `assistant/message` history on a later DSH follow-up. The page itself adds no prompt or tool schema.

#### Token effect

Imported text contributes to the follow-up's history tokens. Discovery and preview make no model request.

#### KV Cache effect

An imported session starts a new DSH request history; it does not inherit a vendor cache or process.

## Known Limitations and Deferred Work

- Discovery offers up to 100 newest transcripts from a bounded scan. Each source file must fit within 16 MiB; previews show its first 2,000 supported text characters. Tools, images, reasoning, and vendor instructions are excluded. Imports are one-shot copies; duplicate imports preserve the existing DSH chat. Unsupported or malformed rows fail individually. Mesh targeting still requires a loaded agent. The UI has no independent runtime invariant because it renders host-owned session and workspace snapshots.

### Dev Note

Implementation anchors and durable behavior notes live in [code notes](../../../docs/code-notes/deepseek-harness.md).
