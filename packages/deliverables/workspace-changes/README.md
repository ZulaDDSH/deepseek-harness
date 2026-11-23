---
description: "Summarize each top-level turn's changed files from git working-tree snapshots and whole-file captures around file-tool edits, announce them with a workspace/changes Session event, and serve the summary and per-file comparisons from a durable, retention-bounded store that outlives the Session and the Host process; configuration, repository requirement, and coverage rules."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-changes

## Summary

This plugin lists changed files, serves bounded comparisons, and provides live Git status and comparisons for registered Workspaces. Turn summaries use Git snapshots and whole-file captures for file-tool edits outside Git coverage. The Host stores each turn's record, captured file copies and snapshot objects in a durable directory that outlives the Session and a Host restart (see Retained data and cleanup) and announces one `workspace/changes` event. Without Git, only file-tool edits appear; the Web card renders summaries.

The Host also serves live status and comparisons for registered Workspaces without appending Session events. Unknown Workspaces and non-Git directories have no status or comparison.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

Repositories without commits count current files against an empty baseline.

-----

<a id="use-this-package"></a>
## Use this package

The shipped Web bundle mounts this plugin. Mount it in any composition with the `subprocess` capability and a git executable on the Host:

```yaml
- name: '@deepseek-ai/dsh-workspace-changes'
  config:
    maxFiles: 500
```

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `30000` | Milliseconds one git command may run before the turn's record is abandoned |
| `outputMaxBytes` | `8388608` | Bytes of git output retained per command; a larger diff listing abandons the record |
| `maxFiles` | `500` | Maximum files carried by one summary; `total` still reports the complete count |
| `maxFileBytes` | `2097152` | Bytes a file may hold to be captured around a file-tool edit or read from a snapshot for its comparison; a larger file gets no comparison, and one captured around a file-tool edit is also listed without counts |
| `diffTimeoutMs` | `100` | Milliseconds a line comparison may run before it degrades to whole-file replacement |
| `root` | `workspace-changes` under the Harness home | Durable directory holding every Session's records, captured copies and snapshot objects; it must not be empty |
| `retentionSessions` | `200` | Session directories kept, newest first; at least 1 |
| `retentionBytes` | `536870912` | Bytes kept across the root; at least 1 |
| `retentionDays` | `30` | Days since a Session directory was last modified before it is removed; `0` removes every directory that is not live |

This plugin requires the `subprocess` and `fs` services. Every Session with a working directory and no subagent origin is recorded; subagent Sessions are not. Snapshots are written through a private index into the Session's durable directory under `root`, with the repository's own object store attached as a read-only alternate; the repository's index, objects, work tree, and refs stay untouched, and the user's earlier uncommitted changes never enter a summary. Session disposal does not remove the directory: it is what serves the Session's earlier turns after a restart, and retention removes it. Nested repositories and submodules inside the working directory are recorded as gitlinks, so their internal changes do not appear. A working directory outside any git repository takes no snapshots. Without git — or, on macOS, with only the developer-tools stub at `/usr/bin/git` — no repository is located either, and the plugin logs that once. Either way the summary lists the file-tool edits alone, as described next, with the working directory as the workspace; shell edits are absent.

After a `write`, `edit`, or mutating `str_replace_editor` call resolves its target and obtains its mutation guard, the recorder copies that exact file before the mutation into the Session's durable directory, once per path per turn, and copies it again at turn end; the copies are named by the SHA-1 of their bytes, so identical content is stored once. This needs no git. Repository discovery and display paths retain the original project; file captures follow the operation's resolved target even after the Session changes directories. Paths the snapshots cover keep their git counts; the copies serve the other paths — files matching an ignore pattern, files outside the repository, and every file-tool edit when there is no snapshot — with counts from a line comparison of the two copies, so repeated edits to one file count once and a shell edit after a file-tool edit is included. A path whose content is unchanged at turn end is not listed. A copy larger than `maxFileBytes` is not stored: the file is listed with `oversized` and no counts, and a path whose both sides are that large is listed too, since unread content is never known to be unchanged. A path whose only difference is a missing final newline compares as unchanged, while git still counts that line. Files under `/tmp` or the platform temporary directory are excluded unless they lie inside the repository. Changes made only through shell commands outside the snapshot coverage are not recorded.

Each file carries a durable `path` — relative to the working directory inside it, absolute elsewhere — and a `display` path used for ordering and labels: the relative path, a `../` path for repository files above the working directory, a `~` path under the home directory, otherwise the absolute path. Files sort by `display` in code-unit order, which lists parent and absolute paths before the working directory's own files. The `workspace/changes` event carries only the turn number; `ctx.workspaceChanges.summary(sessionId, seq)` returns the summary the event with that sequence announced, or undefined when no record for that sequence exists, which includes records pruned by retention. A Session that this process no longer holds, or never held, is served from its durable records. `ctx.workspaceChanges.diff(sessionId, seq, index, signal)` compares the listed file at that index: hunks with three context lines from the two snapshot trees or the two copies, `binary` for a side git reported as binary or that holds a NUL byte, `oversized` for a side larger than `maxFileBytes`. A line comparison that runs longer than `diffTimeoutMs` degrades to one hunk replacing every line, marked `coarse`. A conversation reopened after a Host restart keeps its cards and comparisons for as long as their records survive retention; a comparison whose record was pruned is absent.

Live comparisons use a symlink's target text, matching Git blobs, without reading its destination. Live status counts and comparisons reject paths below symlinked directories, including Windows junctions. Regular work-tree reads consume at most `maxFileBytes + 1` bytes and return `oversized` above the inclusive limit.

The intent listeners capture every add, update, delete, and move target of `apply_patch` after policy admission and before provider mutation; a move captures both ends. Review compares each path against its first baseline and lists net changes, including the completed effects of a stopped patch.

### Retained data and cleanup

<a id="retained-data-and-cleanup"></a>

Each Session gets one directory under `root`. An id made of lowercase letters, digits, `.`, `_` and `-` (at most 100 characters, starting and ending with a letter or digit, and not a Windows device name such as `con` or `nul`) is its own directory name; every other id, including any with uppercase letters, maps to `~` followed by 32 hex characters of its SHA-256, so no id can name `.`, `..` or another Session's directory. Directories written under the earlier naming rule are renamed the first time their Session is requested. Inside a directory, `records/<seq>.json` holds the summary and content sources of the turn announced by the event with that sequence, `captures/` the copies of file-tool edits, and the git object directory the snapshot trees.

Retention runs when the plugin loads and after each completed turn: a Session directory not modified for `retentionDays` is removed, then the oldest remaining directories are removed until `retentionSessions` and `retentionBytes` hold. A Session whose recorder is live in this process is never removed; it counts toward the bounds first, so other Sessions make room for it, and a bound is exceeded rather than a live Session damaged. A Session read by a diff in another process is not protected. Pruning failures are logged and never fail a turn.

On POSIX every directory the plugin creates is `0700` and every copy and record file `0600`, whatever the umask; an existing custom `root` is left as it is and only the Session directories inside it are private. On Windows the modes are ignored and the stores rely on the inherited ACL of `root`, which is neither checked nor repaired.

To remove retained content, stop the Host (or accept that live Sessions keep their directories), then delete the Session's directory under `root`, or delete `root`'s children to remove everything; a removed record leaves a card in the conversation without a comparison. Lowering `retentionDays`, `retentionSessions` or `retentionBytes` removes content at the next prune, and `retentionDays: 0` removes every directory that is not live. Copies live only under `root`, never in the repository.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `TurnRecorder` per Session serializes its git work. `turn/start` queues the baseline: `rev-parse` locates the repository once per Session and the Session's durable directory is created, then `add --all --ignore-errors` into a temporary index seeded from the repository's index and `write-tree` produce the tree id; an unreadable file is skipped and reported through git's exit code 1, which the snapshot keeps but marks incomplete together with the paths git named, and the turn's summary then carries `incomplete`, so its counts are a lower bound and its card says that some files could not be read. Each turn holds its own state object, so a record still running for an interrupted turn keeps that turn's files when the next turn starts. Every command runs with `GIT_OBJECT_DIRECTORY` pointing at the Session's durable directory and `GIT_ALTERNATE_OBJECT_DIRECTORIES` at the repository's objects, so committed content is read from the repository and new objects never land there. Every `tools/pre-execute` waits for that queue before a tool runs, so no mutation can precede its baseline; the filesystem's `fs/write-intent`, `fs/edit-intent`, and `fs/delete-intent` waterfalls delegate the guard decision, then queue and await the capture of the resolved target before mutation, and `tool/result` events only mark that the turn has results to record. `agent/turn-stopping` records inside the turn: a second snapshot, `diff-tree -r -M --numstat` between the two trees, `check-ignore` for captured paths inside the work tree, a second copy and line comparison of each uncovered path, the appended event, and the summary kept under the event's sequence beside each listed file's two content sources, a path in a snapshot tree or a copy. A comparison is computed when asked for: `ls-tree -l` locates and sizes a snapshot side and `cat-file blob` reads it under `maxFileBytes`, copies are read from disk, and both sides go through the same line comparison with its timeout. `turn/end` records again only when tool results settled after the last record attempt, which covers aborted, failed, and steered turns without repeating a failed attempt; an empty list after an earlier record supersedes it. The repository's index is only read.

Git runs through the `subprocess` capability with a scrubbed environment, `GIT_CONFIG_COUNT=0` (ambient indexed configuration is excluded because the credential scrub removes its key entries), `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, the configured timeout, and bounded output. A failing step abandons that turn's record with a warning; the next turn starts afresh. Session disposal and plugin disposal abort queued work and forget the in-memory summaries; the durable directory stays. The record is written before the `workspace/changes` event is appended, so a failed write (full or unwritable disk) announces no card for that turn and logs a warning.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web deliverables](../../client/ui-deliverables/README.md) — the changed-files card that reads the served summary and opens its files.
- [Subprocess capability](../../subprocess/README.md) — the seam git runs through.
- [historical Turn changed-files card decision](../../../.agents/notes/archived/feature/2026-09-11-turn-changed-files-card.md) — snapshot design, coverage rules, the deferred shadow repository, and rejected alternatives.

<a id="model-experience"></a>
## Model Experience

None, as the recorder appends a log-only `workspace/changes` event that only clients read and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Records, snapshot objects and captured copies are retained after their Session ends and after a restart, until retention removes them; file contents, including copies of files outside the repository and ignored files, therefore stay on disk until then (see Retained data and cleanup).
- A turn whose record cannot be written has no card; nothing retries it.
- A snapshot that git could only partly build is served with `incomplete`; the reader is told, but the skipped changes are not recovered.
- Two git features still write into the repository's own git directory during a snapshot: `core.splitIndex` writes `sharedindex.*` files, and git-lfs runs its clean filter on changed files and stores their objects under `.git/lfs`.
- git 2.13 or later is required for `rev-parse --absolute-git-dir`; an unsupported repository format or another git failure abandons the turn with a warning rather than being treated as a plain directory.
- The first snapshot of a Session writes every untracked, non-ignored file of the work tree into the Session's durable directory; a repository without a `.gitignore` that carries large build outputs costs that much space under `root` until retention removes the Session.
- Edits the user makes during a turn are attributed to that turn.
- A working directory outside any git repository lists file-tool edits only, so shell edits are missing from its card; a shadow repository under the Harness home is deferred until its exclude rules can replace a missing `.gitignore` reliably.
- Outside snapshot coverage only paths a file tool names are captured: a file only a shell command changes there is absent, and a file both changed before its first file-tool call is compared from that call onward.
- Every file-tool edit copies its whole file once per turn, up to `maxFileBytes`, even for paths the snapshots also cover; the copies stay in the Session's durable directory until retention removes it.
- A comparison serves the listed file's complete text to the client, including ignored files, repository files above the working directory, and files outside the workspace; the summary route serves only paths and counts. A deployment that must keep such content on the Host composes this plugin out.
- A comparison that degrades to whole-file replacement carries every line of both sides, up to twice `maxFileBytes`.
- Windows paths keep native separators in `path`; `display` is always slash-separated.
- On Windows the stores rely on the inherited ACL of `root`; point a custom root at a directory only your account can read.
- Live path checks and reads are separate filesystem operations; concurrently replacing a parent directory can redirect a read.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`status.ts:readWorkspaceStatus` reads tracked counts with one Git numstat command. `status.ts:countPath` reads untracked counts individually with no-index commands and accepts an empty response as zero counts. Every nonempty response passes through `numstat.ts:parseNumstat`, which returns at least one record or rejects malformed output; command failures remain errors.

</details>
