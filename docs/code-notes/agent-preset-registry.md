# agent-preset-registry code notes

## packages/preset/agent-preset-registry/src/index.ts:AgentPresetRegistry::select (issues 153, 154)

`select` checked that the Session was blank, then awaited `recompose` (resolution, rebind, an awaited collection of the old revision) and only then appended `agent-preset/selected`. The per-Agent queue serializes selections only, so the first prompt could append `turn/start` during any of those awaits: the running Agent was rebound and the selection was logged after the turn had started (153). If the append threw, the already rebound Agent kept the new composition while the log, the projection and restart recovery still named the old one (154).

Fix: `switchBlank` awaits only the resolution (`retain`), then performs blank re-check, rebind and append in one synchronous section, so no turn can start between the check and the commit and a prompt admitted afterwards sees the committed preset. If the append throws, the same synchronous section rebinds the Agent to its previous revision and restores both use counts before rethrowing; the old revision is collected only after the commit, so it is still alive for the rollback. `tools/change` is announced only after the commit, so a failed selection announces nothing. An Agent with no existing binding (no revision to restore) takes the previous bind-then-append path without rollback.

Ceiling: the section is synchronous with respect to this process only; it relies on `turnBoundaryOf` reading the same Session log that `turn/start` is appended to.
