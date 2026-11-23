---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-16-jev-removal

## Summary

Remove JEV decision events and JEV role settings.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-16-jev-removal
baseline: false
changes:
  - root: "event:jev/decision"
    previous: "2026-10-13-jev-decision-unroutable"
    after: null
    decision: same-version
  - root: "event:session/run-options"
    previous: "2026-10-28-auto-responder-setting"
    after: "f29295701829697e32ec3d65ee8da6c06eb965fefdbdfb660aa9385c564290ad"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing sessions using these formats are not supported; the project owner confirmed they are no longer needed.

<a id="verification"></a>
## Verification

The source and generated catalogs remove JEV. The CI persistence checks must validate this acknowledgement.

<a id="dev-note"></a>
## Dev Note

None.
