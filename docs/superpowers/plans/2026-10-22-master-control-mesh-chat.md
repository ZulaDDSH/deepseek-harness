# Master Control mesh chat Implementation Plan

> Home-chat placement and follow-up import/roster scope are superseded by [the home/import/roster plan](2026-10-22-master-control-home-import-roster.md).


**Goal:** You talk to one Master Control session that keeps other sessions working, lets enrolled sessions message each other, and can answer “how are they doing?” from live status and replies.

**Architecture:** Keep the master-preset session as the human chat surface. Expand `tool-master-control` into a mesh: any agent that mounts the tools can `mc_send` / `mc_list` / `mc_interrupt` enrolled loaded peers (not root-only). `mc_send` can wait for the target turn and return the last assistant text; `mc_list` includes a short last-reply excerpt. Mount the tools on `standard` and `lean` (plus existing `master`) with `managedAll: true` so peer sessions can talk back. Master Control UI gains “Open master chat” that creates/opens a `master`-preset session in the main workspace; the roster stays the monitor.

**Tech Stack:** TypeScript, Cordis tools, vitest, existing session/agent APIs (`steer`, `whenIdle`, `snapshotEvents` / `finalAssistantOutput`).

**Spec:** User request 2026-10-22 — Claude-style master chat + session mesh + status answers.

## Global Constraints

- English-only docs (no `.zh.md`).
- Code notes in `docs/code-notes/deepseek-harness.md` with `<file>:<symbol>` anchors.
- Do not mount mesh tools on every exotic preset; `standard`, `lean`, and `master` are enough for v1.
- Targets must still be loaded in `ctx.agents`.

## Review Focus

- Wait timeout / hang on long target turns
- Peer send loops (A→B→A) must not require root
- Master UI create must pass `agentPreset: 'master'`
- Coverage gate for touched packages

## File map

| File | Role |
|---|---|
| `packages/subagent/tool-master-control/src/index.ts` | Mesh auth, wait-on-send, list excerpts |
| `packages/subagent/tool-master-control/tests/tool-master-control.spec.ts` | Unit tests |
| `packages/bundle/web-app/presets/{standard,lean,master}.patch.yml` | Mount tools |
| `packages/client/ui-master-control/src/client/*` | Open master chat action |
| `packages/api/session-controller/src/client/sessions/*` | Pass `agentPreset` on create if missing |
| `.agents/notes/.../2026-10-22-master-control.md` | Update decision |

## Tasks

### Task 1: Mesh tools with wait + excerpts

- [x] Drop root-only authorize; keep self-target and enrollment checks on targets
- [x] Message prefix: `Agent <id> sent a message:` (peer-safe)
- [x] `mc_send` param `wait` (boolean, default false); when true, `whenIdle` then return `{ delivered, reply }` via `finalAssistantOutput`
- [x] Cap wait with timeout (e.g. 120s) — fail with clear error
- [x] `mc_list_sessions` add optional `last_reply` string (truncated)
- [x] Tests for peer send, wait reply, enrollment

### Task 2: Mount on standard + lean

- [x] Add `tool-master-control` with `managedAll: true` to standard and lean patches
- [x] Strengthen master persona / note that mesh + wait are how status works

### Task 3: Master Control UI → master chat

- [x] Inject `openMasterChat` that finds an existing master-preset session or `sessions.create({ agentPreset: 'master', workspaceId })` then `openSession`
- [x] Wire create `agentPreset` through client manager if not already
- [x] Button on Master Control page; update copy
- [x] Client tests

### Task 4: Docs + verify + relaunch

- [x] Update Agent Note + code-notes
- [x] `vitest` focused packages; rebuild; restart `start:web`
