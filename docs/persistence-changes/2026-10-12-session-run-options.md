---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-12-session-run-options

## Summary

Adds the log-only session/run-options event recording per-Session Claude Code fast mode and ultracode toggles.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-12-session-run-options
baseline: false
changes:
  - root: "event:session/run-options"
    previous: null
    after: "0bf87fdace9d0bd797594ab660e895ad3073359cfb4f3ad3a70129a29b507471"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

This is a new ordinary event, so existing Session logs are unchanged and no Session generation changes. A Session without session/run-options uses the Profile ultracode default and sends no fastMode flag, so its runs behave as before. The event is log-only and never enters derived model history. Older readers that do not recognize session/run-options refuse logs that contain it rather than skipping it silently.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts packages/subagent/subagent-claude-code/tests/real-product.spec.ts packages/api/session-controller/tests/hook-overrides.host.spec.ts packages/api/session-controller/tests/session-list-blank.host.spec.ts packages/client/ui-model-selection: the session-controller spec writes runOptions through setRunOptions and reads the projection back, the provider spec takes fast mode, ultracode and effort from the delegating Session, and the client spec toggles the root menu checkboxes.

<a id="dev-note"></a>
## Dev Note

None.
