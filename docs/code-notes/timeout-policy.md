# timeout-policy code notes

## Bounded wait for an uncooperative tool (finding 149)

- `packages/guard/timeout-policy/src/index.ts:apply` - after this plugin's own deadline aborts the derived signal, the wrapper waits `SETTLE_GRACE_MS` more for `next()` to settle. A tool that settles inside the grace behaves exactly as before (result replaced by `TOOL_TIMEOUT`). A tool still pending after the grace is reported as `TOOL_TIMEOUT_UNSETTLED`, a code distinct from `TOOL_TIMEOUT` so retry or replay routing never treats the call as stopped: the message states the tool was asked to stop, did not settle, may still be running, and its effects are unknown. The downstream promise is not cancelled further; a late rejection is swallowed so it cannot surface as an unhandled rejection.
- Only the plugin's own timeout escalates. A caller-side abort (the upstream signal) keeps the old wait, because `timeoutOf(d.signal, TOOL_TIMEOUT)` is undefined for it, and a tool with no declared `timeoutMs` stays unbounded by this policy.
- The grace is a fixed constant, not a config field, so no generated config catalog changes. Hard isolation (running the tool in a killable process) is not added here; tools needing that must supply it themselves.
