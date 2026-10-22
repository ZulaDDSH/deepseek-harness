# Agent Note: Master Control panel, tools, and master preset

Status: implemented

## Problem

A root orchestrator had no first-class way to see every loaded session's live state, open one, or interrupt a running turn from the UI, and no tools that could steer or stop a session that was not an adjacent delegated child. `send_message` and `interrupt_agent` only reach continuations the subagent control tools already know. Operators who wanted a "master" session therefore could not enroll other chats without hand-editing composition rows, and the web client had no panel that surfaced attention, failure, running, and idle across the roster.

## Decision

Ship three pieces that share one enrollment contract:

1. **`@deepseek-ai/dsh-client-ui-master-control`** — a global sidebar panel (`order: -10`, above Plugins) and main page that lists every non-blank session through the existing `useSessions` / `useSessionStatus` hooks. Rows sort attention, failed, running, idle (then recency). Open uses `uiWorkspace.openSession`; interrupt uses `sessions.using(..., { source: 'masterControl' })` then `session.cancel()`, throwing when cancel is not ok.
2. **`@deepseek-ai/dsh-tool-master-control`** — `mc_list_sessions`, `mc_send`, and `mc_interrupt` for a root agent only (`delegationDepthOf(caller) === 0`). Targets must be loaded in `ctx.agents` and enrolled via `Config.managed` or `Config.managedAll`. `mc_send` steers with an `agent-message` relay source; `mc_interrupt` cancels with `{ kind: 'parent' }`.
3. **`master` agent preset** (`packages/bundle/web-app/presets/master.patch.yml`) — mounts `orchestration-policy`, lean-like read/search tools, delegation tools, and `tool-master-control` with `managedAll: true` so every loaded session is enrolled without hand-editing ids. Selective enrollment remains available by setting `managedAll: false` and `managed: [ids]` on that plugin row.

`orchestration-policy` stays opt-in elsewhere: only the master preset mounts it, so other presets' prompt snapshots are unchanged. The Jev router exposes `enabled` so the policy can state the router-owned route clause when routing is on.

## Verification

- `tool-master-control` unit tests cover list/send/interrupt, enrollment rejection, self-target, non-root callers, and unloaded targets.
- `ui-master-control` client tests cover `apply` registration and interrupt failure, `masterRows` ordering, and the page's open / interrupt / empty / loading paths.
- `orchestration-policy` unit tests and the in-process driver Jev routing spec cover root-only policy text.

## Alternatives considered

| Rejected | Reason |
|---|---|
| Reuse `send_message` / `interrupt_agent` for every session | Those tools only address adjacent subagent continuations; a master must reach arbitrary enrolled loaded sessions |
| Leave `managed` empty and require hand-edited ids | Blocks out-of-the-box use; `managedAll: true` on the master preset is the enrollment default, with selective lists still available in config |
| Per-row enroll checkboxes writing Host composition config | Needs a Host write path for live agent composition that does not exist yet; defer until that seam ships |
| Mount orchestration-policy on every root preset | Would change recorded prompt snapshots for every shipped preset; keep it master-only |

## Consequences

- Sessions started on the `master` preset can list, steer, and interrupt any loaded session, and receive the root orchestration policy section.
- The Master Control panel is available in the web bundle for every profile that loads `ui-master-control`, independent of which preset a session uses.
- Selective enrollment and a dedicated enroll UI remain config-only until a Host composition write API exists.
