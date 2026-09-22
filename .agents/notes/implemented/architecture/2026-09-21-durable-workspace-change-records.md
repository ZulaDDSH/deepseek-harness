# Agent Note: Durable workspace change records

Status: implemented

English | [中文](2026-09-21-durable-workspace-change-records.zh.md)

## Problem

The [changed-files card](../feature/2026-09-11-turn-changed-files-card.md) served each turn's summary and comparisons from memory and from a per-Session temporary directory that disposal removed. A conversation reopened after a Host restart therefore had no card and no comparison for its earlier turns, even though the log-only `workspace/changes` announcement that names them survived in the Session log. A chat client reopens conversations routinely, so the content the announcement points at was the one part of the record that did not last.

## Decision

One durable directory per Session under the plugin's `root` holds everything a comparison reads: `records/<seq>.json` (the served summary plus each listed file's two content sources), `captures/<sha1>` (whole-file copies taken around file-tool edits), and `objects/` (the private git object store the snapshot trees land in). `root` defaults to `$DSH_HOME/workspace-changes`, and the shipped Web bundle sets it explicitly from `dshHomePath('workspace-changes')`.

`TurnRecorder` writes the record to disk before the summary can be served, so a restart cannot lose a card the client was already told about. `dispose()` aborts queued work and forgets the in-memory records, and leaves the directory in place.

`WorkspaceChanges.summary` returns a promise. A miss in the live recorder reads the record from the Session's directory, and `diff` rediscovers the repository from the record's `cwd` and reads snapshot sides from that Session's own object store, so a Host process that never recorded the Session serves it on the same terms as the process that did.

Retention bounds the root with `retentionSessions` (200), `retentionBytes` (512 MiB), and `retentionDays` (30). Pruning runs at plugin load and after every completed turn: a directory older than the age bound is removed first, then the oldest remaining directories until the count and byte bounds hold. A session directory's age comes from its own `stat()`, so a directory that holds no files yet is not treated as expired.

## Alternatives considered

**Leaving the card and its content on the Session's lifetime** was the shipped behavior before this decision, on the reasoning that a card whose content the Host can no longer open should not appear at all. It loses because the announcement event outlives the content it names: after a restart the log still records that a turn changed files while the card silently disappears, so the client and the log disagree. Bounding the record by retention keeps the card and its content equal in lifetime without tying either to the process.

**Recording the summary and its counts in the `workspace/changes` event** so the log carries the card was rejected earlier and stays rejected: the log would gain file paths and line counts for every turn that only clients read, and it still could not carry the comparison content the card opens, which needs the captures and snapshot objects regardless.

**One shared snapshot object store per repository under the Harness home** was the earlier placement, rejected because a Session's snapshot failed when another Session discarded the store and its byte bound could not be attributed. The durable directory is per Session, so pruning one Session never touches another's objects, and the root-wide byte bound is enforced oldest-Session-first.

**Keeping records for recent Sessions only, in a fixed-size ring** was rejected in favor of the retention bounds: count, bytes, and age are the three the operator can reason about from `cordis.yml`, and the Web bundle already sets all three explicitly.

## Consequences

A conversation reopened after a Host restart keeps its cards and its comparisons. The record is bounded rather than permanent: past `retentionSessions`, `retentionBytes`, or `retentionDays` the oldest Session directories are removed and their turns have no card and no comparison.

A comparison is now served from content an operator did not necessarily expect to persist on disk. Captured copies and snapshot objects under `root` include ignored files, files outside the repository, and files outside the workspace, so a deployment that must keep such content off the Host composes this plugin out. The repository's own index, objects, work tree, and refs stay untouched.

`root` is deployment-varying configuration with a default under `$DSH_HOME`; tests that boot the plugin pass an explicit `root` so they never write into the operator's real Harness home. Growth is bounded by the retention bounds rather than by the number of Sessions ever recorded.

`packages/deliverables/workspace-changes/tests/plugin.spec.ts` pins the objective: it records a turn, disposes the context, boots a second context over the same root, and serves both the summary and the file diff. `tests/store.spec.ts` covers record validation, session-directory sanitization, and pruning by age, count, and bytes.
