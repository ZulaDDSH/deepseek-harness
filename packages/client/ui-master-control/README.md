---
description: "Master Control home, external text imports, and workspace session supervision in the web client."
kind: "package-reference"
---
# Master Control UI

## Summary

Master Control opens a dedicated supervising chat, previews Claude Code and Codex text histories for explicit import, and groups the session roster by workspace. Search and status filters narrow the roster; rows open conversations or interrupt running work. The normal conversation UI owns continued chats.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The web bundle mounts a dedicated control-center page above Plugins. Its master conversation and composer stay beside the session overview instead of opening an ordinary workspace chat. The host reuses one durable master home, which is excluded from ordinary chat lists and the worker roster. Roster groups use existing workspace membership, with Ungrouped for other sessions.

Master Control discovers local Claude Code and Codex transcripts and keeps source activity fresh while the page is open, refreshing once a minute. Discovery never imports: only the chats selected in Import chats are copied, so opening the page cannot create sessions. Import chats previews, filters, and imports the selected histories. Open shows the imported conversation in the normal DSH UI. Imported chats use the standard preset and continue with DSH's agent and tools. Idle chats with no source or DSH activity for at least seven days appear in the Archive menu; fresh activity returns them to the active view.

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

- Discovery includes every candidate within the bounded directory scan. Source files are streamed; retained conversation data is limited to 16 MiB per chat, and previews show its first 2,000 supported text characters. Tools, images, reasoning, and vendor instructions are excluded. Imports are one-shot copies; duplicate imports preserve the existing DSH chat, while source activity timestamps refresh. Unsupported or malformed rows fail individually. Mesh targeting still requires a loaded agent. The UI has no independent runtime invariant because it renders host-owned session and workspace snapshots.

### Dev Note

Implementation anchors and durable behavior notes live in [code notes](../../../docs/code-notes/deepseek-harness.md).
