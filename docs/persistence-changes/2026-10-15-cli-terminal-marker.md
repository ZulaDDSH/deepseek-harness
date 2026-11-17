---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-15-cli-terminal-marker

## Summary

Adds the `session/cli-terminal` event. A CLI terminal Session writes it once, when it is created, with its profile id (`gemini-cli`, `grok-cli` or `cursor-cli`). The record command acknowledges every pending root, so this record also acknowledges two optional-property additions that were pending in the working tree: `event:session/run-options.data.subagentSetup` and `event:subagent/descriptor.data.routePinned`. Their owners should review this record before merge.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-15-cli-terminal-marker
baseline: false
changes:
  - root: "event:session/cli-terminal"
    previous: null
    after: "ff56d607f708d05e5bb71db059bb0594209239fc89f5f1498a6865df7a53ddb7"
    decision: same-version
  - root: "event:session/run-options"
    previous: "2026-10-12-session-run-options"
    after: "687330ec24b6e986e29a3c19acb330e3ee38cec744ed75ce83bc3611adefcce8"
    decision: same-version
  - root: "event:subagent/descriptor"
    previous: "2026-09-11-initial"
    after: "6b4761bd56f4dd4fd6ed66e48f8e726b710cea8377db667112caacff439af52f"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

`event:session/cli-terminal` is a new root. Its `profile` is a required literal union of the three profile ids. Ordinary Sessions never write the event, so existing logs contain none. The two other roots add optional properties only. The tool classifies all three as `same-version`, and none requires a version bump.

<a id="verification"></a>
## Verification

Before this record, `persistence-changes --check` reported three unacknowledged roots: `event:session/cli-terminal`, `event:session/run-options.data.subagentSetup` and `event:subagent/descriptor.data.routePinned`. The digests in the declaration are the ones the tool reported when it wrote this record.

<a id="dev-note"></a>
## Dev Note

None.
