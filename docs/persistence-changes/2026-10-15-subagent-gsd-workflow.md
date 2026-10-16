---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-15-subagent-gsd-workflow

## Summary

Adds an optional `gsd` object to the subagent setup stored in session run options. It turns on the GSD workflow for a top-level orchestrator session: the gate mode, plan author, `.planning/` placement, check rounds and parallel waves. Existing run-options data without `gsd` reads unchanged.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-15-subagent-gsd-workflow
baseline: false
changes:
  - root: "event:session/run-options"
    previous: "2026-10-15-cli-terminal-marker"
    after: "89f9a82d1d223cdafd9e472d036debc99cb68c4eb374f50c5d70ed83ea4eefa6"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Same version. The `gsd` property is optional, so existing run-options data reads unchanged. The setup schema is strict, so a build without this change rejects run-options data that carries `gsd`. Downgrading requires clearing `gsd` from each stored setup first.

<a id="verification"></a>
## Verification

`packages/api/session-controller/tests/subagent-setup.host.spec.ts` covers the schema defaults and rejections, the GSD prompt section and its top-level-only gate, and the global default fallback. `packages/client/ui-subagent/tests/subagent-setup-contract.client.spec.ts` pins the browser copy to the Host text. Run: `vitest packages/api/session-controller packages/client/ui-subagent scripts/client-bundle-purity.spec.ts`, then `npx tsx scripts/persistence-changes.ts --check`.

<a id="dev-note"></a>
## Dev Note

None.
