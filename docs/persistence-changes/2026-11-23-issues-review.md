---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-23-issues-review

## Summary

Adds the claude-code-mod message source kind, optional localOnly on feedback events, a version 2 goal refund payload, and the image/restore event. The claude-code-mod source member (`{ kind: 'claude-code-mod', mod?: string }`) is the only change to the message source of agent/inbox/spliced, developer/message, session/title-llm-request and user/message.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-23-issues-review
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-05-timeline-priority-notice"
    after: "e63dfc4ff0935fd04abe9fa7f5e7d83444724f3df2852ae291accc9f93ebf495"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "f9eda7805d466a9482f0b43995eaf524942e87d60dfe471e295f8e15bf8d67d3"
    decision: same-version
  - root: "event:feedback/message-delete"
    previous: "2026-09-11-initial"
    after: "a067fab92c3cbb15f75062f0c76fc43d6840f0cc1269142ea2e08c2aaba83706"
    decision: same-version
  - root: "event:feedback/message-put"
    previous: "2026-09-11-initial"
    after: "f36df18f6960754bd811c25382c53084a0e6827677c43505b0e28b8dfa4489a5"
    decision: same-version
  - root: "event:feedback/record"
    previous: "2026-09-11-initial"
    after: "5d6aa23f5d8acca870642a4afe3ef9d1609f8524cdfc54832d7a2a53d9340fe5"
    decision: same-version
  - root: "event:goal/change"
    previous: "2026-09-11-initial"
    after: "53e60965b773cb143edc05c89526a9ab9dbf8d87cb83656328178d2f637a586e"
    decision: same-version
  - root: "event:image/restore"
    previous: null
    after: "2efc0cf5cc83ced3672311d0342d2e24d0796b9cb5f5698e016306ff78b668bf"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-05-timeline-priority-notice"
    after: "cad5973940875472d089337e11353b825cd4803557129e91e106ff1a63ce13a5"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "c86df19491f6749f2ffcc321c3bafd1f36c9e5d1acd201ee9dd02863ae70ceb5"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing logs fold unchanged. Old readers meeting a claude-code-mod source, a goal refund v2, or image/restore treat them as unknown or refuse the goal projection (GOAL_STATE_CORRUPT) without repairing or truncating the Session. localOnly is optional and absent on old records. New readers accept every old record.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/goal: 161 tests passed; goal-round-driver, claude-code-mods, feedback and compaction-image-offload specs passed in their owners' runs.

<a id="dev-note"></a>
## Dev Note

None.
