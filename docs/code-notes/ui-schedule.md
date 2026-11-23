# ui-schedule code notes

## packages/client/ui-schedule/src/client/recent-time-zones.ts:loadRecentTimeZones

Finding 175. `typeof localStorage` evaluates the window getter, which throws a SecurityError when the browser blocks storage (cookies disabled, sandboxed frame), so the "storage missing" check threw out of the time-zone picker. Both `loadRecentTimeZones` and `rememberTimeZone` now read the store through `browserStorage()` from the store package, which returns undefined instead of throwing; the existing try blocks still cover method failures such as a full quota.
