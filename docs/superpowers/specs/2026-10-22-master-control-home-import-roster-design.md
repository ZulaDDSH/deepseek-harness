# Master Control home, external import, and roster grouping

**Status:** implementation scope — text-history import and DSH continuation

**Date:** 2026-10-22

**Product:** DeepSeek Harness (DSH) Master Control

## Intent

You use Master Control as a **supervision desk**: one dedicated chat that always exists and never belongs to a project folder, a roster of every session you care about (including chats that started in Claude Code or Codex), and a way to scan that roster by project.

Today, **Open master chat** can land in a random project session, the roster only shows DSH-native sessions, and the list is a flat table. That breaks the “Claude-style master that keeps other sessions in line” workflow.

## Goals

1. **Dedicated Master Control home chat** — always-there supervising session; Open master chat always opens that same chat; it is not nested under a project workspace.
2. **Import Claude Code and Codex chats into DSH** as real sessions you can open and continue (resume with history visible and a usable follow-up turn).
3. **Roster categorized primarily by project folder**, with session-name search and status filters so a long list is scannable.

## Non-goals

- Rewriting Master Control into a full second chat shell (reuse the normal conversation UI).
- Perfect byte-for-byte fidelity of Claude/Codex tool state, permissions, or vendor-specific memory.
- Syncing live two-way with Claude/Codex after import (import is a one-shot bring-into-DSH).
- User-defined arbitrary tag taxonomies in v1 (deferred; search + folder + status cover the first cut).
- Host enroll checkboxes for mesh tools (already deferred).

## Anti-goals

- Opening “a coding session that happens to use the master preset” under GardenEngine or another project and calling that Master Control.
- A roster that lists external chats as links you cannot open or continue inside DSH.
- Import that creates empty sessions with only a title (no transcript).

## Constraints

- English-only docs; code notes with `<file>:<symbol>` anchors.
- Mesh tools (`mc_*`) from the prior ship stay; this work does not replace them.
- Sessions must still be loaded in `ctx.agents` for mesh targeting.
- Prefer existing workspace grouping concepts (`UNGROUPED_KEY`, workspace membership) over a new parallel catalog.
- Supported external sources for v1: **Claude Code** (`$CLAUDE_CONFIG_DIR` or `~/.claude`) and **Codex** (`~/.codex`) on-disk session stores. Parsers must match observed records and reject malformed rows. Discover, preview, import, and open must all work.

## Design

### 1. Dedicated Master Control home

**What you see**

- Master Control panel keeps the roster.
- **Open master chat** always opens one session titled **Master Control** (or locale equivalent).
- That session does **not** appear under a project folder in the workspace browser; it lives in **Ungrouped** (or an equivalent non-project bucket), pinned or otherwise easy to find from Master Control only.
- The conversation chrome shows Master Control as the supervising agent, not a random project name as the owning workspace.

**Behavior**

- First click: create a session with `agentPreset: 'master'`, **no `workspaceId`** (ungrouped), a reserved home identity, and durable title Master Control. Resolve that identity on the host on later launches.
- Later clicks: open that same id; never `workspaces.items[0]`, never “first blank in GardenEngine.”
- If the home is gone or archived, recreate once.
- Creating/opening home must not steal focus into an unrelated existing session that merely has a missing or stale `agentPreset` projection.

**Bug this fixes**

Current `openMasterChat` prefers any session with projected `agentPreset === 'master'`, else creates under `workspaces.items[0]`. Missing projections and “first workspace” both produce the random-project experience in the screenshots.

### 2. Import Claude / Codex into DSH

**What you see**

- On the Master Control page: **Import chats…**
- A picker lists recent Claude Code and Codex sessions (title/cwd/updated), multi-select, confirm.
- After import, rows appear in the roster under the matching project folder when cwd matches a known workspace; otherwise Ungrouped.
- Opening an imported session shows prior user/assistant turns and accepts new messages in DSH.

**Behavior (builder-owned details marked)**

- Discover on-disk transcripts from Claude Code and Codex roots (builder call: exact paths/parsers after a spike against this machine’s stores).
- For each selected source: create a DSH session with cwd/workspace best-effort from the source project path; seed the session log with imported user and assistant **text** turns; set a clear title (source title or truncated first prompt); mark origin so the UI can show a small “Imported” cue.
- Resume = continue in DSH with the seeded history. Imported sessions use a normal coding preset (`standard` by default), not the master home.
- Dedup: preserve and report the existing import for the same source/path identity; never replace it.
- Failures are per-row (one bad file does not abort the batch).

### 3. Roster grouping and filters

**What you see**

- Roster grouped by **project folder** (workspace label / path basename), with **Ungrouped** for sessions without a workspace, and Master Control home either omitted from the worker table or listed once under a fixed “Master Control” section (builder call: omit from worker table — home is opened via the button only).
- Within a group: sort by updated time (newest first); show session display title and cwd as today.
- Filters above the table: text search on title/cwd; status chips (all / running / attention / failed / idle).
- Flat “no grouping” toggle is optional if cheap; not required for v1.

**Builder call:** primary key is workspace membership already known to the client (`workspaces` + session cwd); do not invent a second folder taxonomy.

## Success

- Open master chat twice → same supervising session, not under GardenEngine.
- Import a recent Claude or Codex chat → appears in roster → open → history visible → send a follow-up that runs in DSH.
- Roster with many sessions is grouped by project; search and status filters narrow it.

## Left to the builder

- Exact Claude/Codex on-disk formats and parsers (spike first).
- Reserved host identity prefix for home sessions.
- Whether imported origin is a projection key or a title prefix.
- Minimal Host API if seeding history cannot be done from existing session create + append paths alone.
- Omit Master Control home from the worker roster table (open only via the button).
- Default imported agent preset: `standard`.
- Dedup key: stable external path/id string stored on the session (builder picks projection vs meta).

## Resolved v1 scope

Import preserves supported user/assistant text and continues using DSH's standard agent and tools. It does not resume the original vendor process or session. The picker offers up to 100 newest transcripts from a bounded host scan, with a 16 MiB per-file limit and a 2,000-character text preview. Unsupported content is disclosed before import. Existing imported identities are preserved; replacement and re-import merging are excluded.

The host resolves a reserved home identity and durable title, serializes repeated requests, and recreates the home after archival or deletion. This replaces the draft's client-preference/title-search suggestion. Workspace membership determines roster groups; source cwd only determines best-effort workspace attachment during import.

Implementation and acceptance tracking: [home/import/roster plan](../plans/2026-10-22-master-control-home-import-roster.md).

## Out of scope follow-ups

- Live sync / re-import merge.
- User tag editor.
- Import from Cursor / other agents beyond Claude Code and Codex.
