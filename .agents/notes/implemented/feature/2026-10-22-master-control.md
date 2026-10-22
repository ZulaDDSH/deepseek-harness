# Agent Note: Master Control panel, mesh tools, and master chat

Status: implemented

## Problem

Operators need a Claude-style master chat that assigns work to other sessions, lets those sessions talk peer-to-peer, and can answer “how are they doing?” from live status and replies. The first Master Control ship had a roster panel and fire-and-forget `mc_*` tools on a root-only master preset, which was not enough for mesh messaging or status answers with reply text.

## Decision

1. **Mesh `tool-master-control`** — Any agent that mounts the tools can `mc_list_sessions` / `mc_send` / `mc_interrupt` enrolled loaded peers (self-target still forbidden). `mc_send` accepts `wait` (default false); when true it awaits `whenIdle` (120s timeout) and returns `reply` from `finalAssistantOutput`. `mc_list_sessions` includes a truncated `last_reply`. Message prefix is `Agent <id> sent a message:`.
2. **Presets** — Mount `tool-master-control` with `managedAll: true` on `master`, `standard`, and `lean`. Only `master` mounts `orchestration-policy`.
3. **Home** — `MasterControlSessions.openHome` resolves one reserved master identity on the host, creates it without workspace membership, assigns a durable Master Control title, and recreates it after archival or deletion. Metadata classifies this home as nonblank so ordinary navigation cannot reuse it as a provisional chat. The normal create operation rejects reserved home and import identities.
4. **Imports** — `ExternalChats` discovers bounded local Claude/Codex logs and exposes supported-text previews. Imports preserve user/assistant text in balanced ordinary DSH history with an empty protected system head, persist before success, attach matching workspaces, and preserve duplicates. Tools, attachments, reasoning, vendor instructions, and live vendor continuation are excluded.
5. **Roster** — `groupMasterRows` uses existing workspace membership, orders by recency within groups, filters title/cwd and state, and omits home identities from the worker table.

## Verification

- `tool-master-control` tests: peer send, wait+reply, enrollment, timeout, list excerpts.
- Host regressions cover repeated home requests, reserved-id refusal, unrelated master sessions, archival, imported model history, duplicate preservation, failure isolation, and shutdown/reopen through JSONL persistence.
- Client regressions cover real plugin assembly, import outcomes, groups, and filters. `apps/web/tests/master-control.e2e.ts` exercises the actual Chromium/host/client composition with temporary source logs.
- The local worktree passes focused tests, full build, host/client typechecks, lint, and documentation checks. Provider transport is mocked in follow-up acceptance; the installed user profile is outside this verification.

## Alternatives considered

| Rejected | Reason |
|---|---|
| Rewrite Master Control into a full chat shell | Reuses the existing conversation UI via master preset; smaller surface |
| Keep root-only `mc_*` | Blocks peer-to-peer session messaging |
| Fire-and-forget send only | Master cannot answer “how are they doing?” with reply content without wait/list excerpts |

## Consequences

- Standard/lean sessions can message each other and the master through the same tools.
- Long target turns can hit the 120s wait timeout; callers should use `wait=false` for fire-and-forget.
- Unloaded sessions still cannot be targeted until opened in the UI.
