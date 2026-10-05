---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-03-hook-overrides-and-jev-decisions

English | [中文](2026-10-03-hook-overrides-and-jev-decisions.zh.md)

## Summary

Adds two log-only Session events: hooks/session-overrides records the complete per-Session hook enable/disable map, and jev/decision records each Jev routing outcome (choice, confidence, applied route or error).

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-03-hook-overrides-and-jev-decisions
baseline: false
changes:
  - root: "event:hooks/session-overrides"
    previous: null
    after: "8f1df624af4d2a5d9aa39342beb3d354c8147388e80ba7a0cf9b6aa7d1cb0f5e"
    decision: same-version
  - root: "event:jev/decision"
    previous: null
    after: "06f9dc0f3520fd54d8bb07d330acf0d089e87898429952c991c18803eddaf7f8"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing event schemas and Session generations are unchanged. Neither event enters model history. Sessions without hooks/session-overrides use each bridge's enabledHooks setting; Sessions without jev/decision behave as before. Both events are required on read: older builds that do not recognize them refuse affected logs rather than silently discard the records.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/llm/llm-jev-router packages/api/session-controller packages/client/ui-conversation: Jev routing records one decision per turn including failures, and the session hooks popup writes overrides through setHookOverrides.

<a id="dev-note"></a>
## Dev Note

None.
