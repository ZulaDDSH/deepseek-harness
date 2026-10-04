---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-04-jev-decision-applied-route

English | [中文](2026-10-04-jev-decision-applied-route.zh.md)

## Summary

`jev/decision` events gain an optional `route` property: the id of the route the router applied, which is Jev's choice or, when Jev was not confident enough, the configured fallback route. The change adds an optional event-body property, so the decision is same-version.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-04-jev-decision-applied-route
baseline: false
changes:
  - root: "event:jev/decision"
    previous: "2026-10-03-hook-overrides-and-jev-decisions"
    after: "67e3254d4c1681544ea248f66723bc83de41f0dfae84598b91b1bc46838fe663"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing `jev/decision` records omit `route` and stay valid; the `jevDecision` projection and the composer routing panel treat a missing `route` as Jev's own choice, which is how those records were written. The event is log-only and never enters model history, so older readers that ignore the property replay the Session unchanged.

<a id="verification"></a>
## Verification

`pnpm exec vitest run packages/llm/llm-jev-router` passed 49 tests, including records for a confident pick, a fallback route and a kept chat model. `pnpm exec vitest run packages/client/ui-model-selection` passed 72 tests at 100% coverage, including the fallback explanation. `pnpm run verify-persistence-catalog` passed after regeneration.

<a id="dev-note"></a>
## Dev Note

None.
