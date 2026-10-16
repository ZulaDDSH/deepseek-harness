---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-12-session-run-options

## Summary

Adds the log-only session/run-options event recording per-Session Claude Code fast mode, ultracode and effort run options.

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
    after: "2134d708b7e49b6f48beb0ca7692ee7e7ec209e797748725d032c5362db9edd8"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

This is a new ordinary event, so existing Session logs are unchanged and no Session generation changes. A Session without session/run-options sends no fastMode flag and no effort, and sends ultracode only when the Profile sets it, so native Claude settings decide everything the Profile leaves unset and runs under such a Profile behave as before. The event is log-only and never enters derived model history. Older readers that do not recognize session/run-options refuse logs that contain it rather than skipping it silently.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts packages/subagent/subagent-claude-code/tests/real-product.spec.ts packages/api/session-controller/tests/hook-overrides.host.spec.ts packages/api/session-controller/tests/session-list-blank.host.spec.ts packages/client/ui-model-selection: the provider spec takes fast mode, ultracode and effort from the Session run options and registers the runOptions projection, the session-controller spec stores effort, and the client spec covers the switches, serialized writes and the Claude Code effort choice.

<a id="dev-note"></a>
## Dev Note

None.
