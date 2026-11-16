---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-28-auto-responder-setting

## Summary

Adds an optional `autoResponder` object ({ enabled }) to the subagent setup stored in session run options. When enabled, a reviewer reads the agent's last message after a turn and may send the next message for it.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-28-auto-responder-setting
baseline: false
changes:
  - root: "event:session/run-options"
    previous: "2026-10-15-subagent-gsd-workflow"
    after: "490eccfaf4a3233b6a932a108665cb1655777aab97637487afde06c269db912d"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Same version. The `autoResponder` property is optional, so existing run-options data reads unchanged. The setup schema is strict, so a build without this change rejects run-options data that carries `autoResponder`. Downgrading requires clearing it from each stored setup first.

<a id="verification"></a>
## Verification

`packages/api/session-controller/tests/auto-responder.host.spec.ts` covers the responder and `packages/client/ui-subagent/tests/subagent-setup-contract.client.spec.ts` covers the schema accepting and strictly rejecting extra keys. Run: `vitest packages/api/session-controller packages/client/ui-subagent`, then `npx tsx scripts/persistence-changes.ts --check`.

<a id="dev-note"></a>
## Dev Note

None.
