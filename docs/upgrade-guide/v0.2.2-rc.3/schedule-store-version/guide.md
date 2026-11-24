---
kind: upgrade-guide
description: "The schedule store unit is stamped version 3 on its first write, so an older DSH binary refuses a store that this release has written."
---

# Schedule store unit version 3

## Change

The `schedule` storage domain now declares `version: 3` and still reads units stamped 1 and 2. Reading never writes. The first write after upgrading (a task created, edited, deleted, or delivered) stamps the unit `version: 3` in `<DSH_HOME>/storages/schedule.json`, or in the `schedule` row of `units.version` in SQLite. The task row format does not change. A DSH binary from before this release, which supports only versions 1 and 2, rejects a store stamped 3 and does not activate its tasks.

## Migration

1. Upgrade every DSH binary that shares the same `DSH_HOME` before this release writes to the schedule store.
2. To roll back after a write, restore `schedule.json` (or the SQLite file) from a backup taken before upgrading; no downgrade command exists.
3. Confirm by opening `schedule.json` and checking `"unit": { "name": "schedule", "version": 3 }`, or run `schedule/list` on the upgraded binary.
