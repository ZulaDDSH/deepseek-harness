---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-04-jev-decision-applied-route

English | [中文](2026-10-04-jev-decision-applied-route.zh.md)

## Summary

`jev/decision` events gain two optional properties: `route`, the id of the route the router applied, which is Jev's choice or the configured fallback route when Jev was not confident enough, and `rejected`, which states the outcome of a failed decision: true when the router stopped the turn, false when it kept the chat model. Both are optional event-body properties, so the change is same-version.

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

Existing `jev/decision` records stay valid. A record written before `route` existed omits it, and its `provider`/`model` can name the fallback that actually ran while `choice` holds the pick Jev made and the router rejected, so a reader must not treat a missing `route` as the applied route id. A record written before `rejected` existed omits it, and those records were written for both failure policies, so absence establishes neither a kept chat model nor a stopped turn and a reader must not infer one; the router records `rejected` on every failed decision. The event is log-only and never enters model history, so older readers that ignore either property replay the Session unchanged.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/llm/llm-jev-router passed 53 tests, including a stopped-turn record folded through the projection state and wire view. pnpm exec vitest run packages/client/ui-model-selection passed 79 tests at 100% coverage, including the neutral, kept and stopped failure copy. pnpm run verify-persistence-catalog passed after regeneration.

<a id="dev-note"></a>
## Dev Note

None.
