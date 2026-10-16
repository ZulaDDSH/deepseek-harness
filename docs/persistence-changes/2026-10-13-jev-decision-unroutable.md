---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-13-jev-decision-unroutable

## Summary

`jev/decision` events gain an optional `unroutable` property. The router sets it to true when Jev's chosen route id names a configured route whose provider is not registered in the current composition; in that case the router keeps the base route, and the event records the choice without an applied route. The property is optional and same-version.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-jev-decision-unroutable
baseline: false
changes:
  - root: "event:jev/decision"
    previous: "2026-10-04-jev-decision-applied-route"
    after: "f1f8d4b139695db9bb91a290ae04a839479564c93897f9c1e3f42a73525c8d84"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing `jev/decision` records stay valid. A record written before `unroutable` existed omits it, and a reader must not infer from that absence that the choice was routable. The router writes the property only when it is true, so a missing `unroutable` on a successful decision means the router did not flag the choice. The event is log-only and never enters model history, so older readers that ignore the property replay the Session unchanged.

<a id="verification"></a>
## Verification

Read `packages/llm/llm-jev-router/src/index.ts`, where `unroutable` is computed from the configured routes and the routes whose providers are registered, and `packages/llm/llm-jev-router/src/types.ts`, where `JevDecisionRecord.unroutable` is declared as optional. Ran `node_modules/.bin/vitest run packages/llm/llm-jev-router`: 4 test files and 55 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
