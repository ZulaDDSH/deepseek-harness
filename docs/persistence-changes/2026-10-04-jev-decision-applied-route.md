---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-04-jev-decision-applied-route

English | [中文](2026-10-04-jev-decision-applied-route.zh.md)

## Summary

`jev/decision` events gain two optional properties: `route`, the id of the route the router applied, which is Jev's choice or the configured fallback route when Jev was not confident enough, and `rejected`, which marks a turn the router stopped instead of keeping the chat model. Both are optional event-body properties, so the change is same-version.

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
    after: "96bc55e52033bf9462b9aa0df7f3f2f48ff8965804e638edfc54064afe8a2f1f"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing `jev/decision` records stay valid. A record written before `route` existed omits it, and its `provider`/`model` can name the fallback that actually ran while `choice` holds the pick Jev made and the router rejected, so a reader must not treat a missing `route` as the applied route id. A record written before `rejected` existed omits it, and absence means the router kept the chat model, which is what those records recorded. The event is log-only and never enters model history, so older readers that ignore either property replay the Session unchanged.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/llm/llm-jev-router passed 52 tests, including a record for a turn the router stopped when it fails closed. pnpm exec vitest run packages/client/ui-model-selection passed 78 tests at 100% coverage, including the stopped-turn and legacy-fallback copy. pnpm run verify-persistence-catalog passed after regeneration.

<a id="dev-note"></a>
## Dev Note

None.
