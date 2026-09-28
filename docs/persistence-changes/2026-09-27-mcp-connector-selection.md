---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-27-mcp-connector-selection

English | [中文](2026-09-27-mcp-connector-selection.zh.md)

## Summary

Adds the mcp/selection Session event with the selected connectorIds.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-27-mcp-connector-selection
baseline: false
changes:
  - root: "event:mcp/selection"
    previous: null
    after: "1ccb7116650e66089c8d2958f212e08a2311cdd8db1978f9d8fe05509032ecac"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing event schemas and Session generations are unchanged. Sessions without mcp/selection retain the existing connector defaults. The new event is required on read: older builds that do not recognize it refuse affected logs rather than silently discard the selection.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/api/session-controller/tests/mcp-selection.host.spec.ts: two tests passed, covering controller installation without injected tools and restriction to the selected connector.

<a id="dev-note"></a>
## Dev Note

None.
