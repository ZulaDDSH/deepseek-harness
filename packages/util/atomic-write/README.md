---
description: "Atomic file replacement and cross-process writer locking for packages that must never leave partial, symlink-hijacked, or wider-permission content on disk."
kind: "package-library"
---

# @deepseek-ai/dsh-atomic-write

## Summary

Use `dsh-atomic-write` to replace a file without exposing partial content or following a symlinked temporary path. Its writer lock serializes read-modify-write cycles across processes so concurrent writers cannot overwrite one another with stale state. Each replacement uses caller-selected permission bits on a fresh inode, which safely narrows an existing file's permissions. This library depends only on `dsh-error` for its lock failure and accepts strings and binary byte arrays; it does not provide a `cordis.yml` plugin or crash durability beyond the best-effort `fsync` described in Known Limitations.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use `writeFileAtomic` when a file-backed store must replace complete text or binary content without ever exposing a partial, symlink-hijacked, or wider-permission state, and `withFileLock` when several processes read-modify-write the same file. The smallest path is one call with the final content and the replacement's permission bits.

### Writing a file atomically

```ts
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

declare const text: string
await writeFileAtomic('/home/u/.dsh/cordis.patch.yml', text, { mode: 0o600 })
```

Parent directories are created as needed, and readers observe either the old or the new complete content. On Windows, transient replacement interference reported as `EACCES`, `EBUSY`, or `EPERM` is retried for a bounded interval; any remaining failure removes the temporary file and leaves the target untouched.

### Coordinating writers

For a read-render-commit cycle that a bare atomic commit cannot make safe on its own, hold the writer lock around the operation:

```text
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

declare const render: (previous: string) => string
declare const readCurrent: () => Promise<string>

await withFileLock('/home/u/.dsh/cordis.patch.yml', async () => {
  const previous = await readCurrent()
  await writeFileAtomic('/home/u/.dsh/cordis.patch.yml', render(previous), { mode: 0o600 })
})
```

Only writers contend — readers never take the lock — and a contender backs off exponentially and fails with a timed-out error rather than blocking forever. How long a contender waits is stated per call through `waitMs`: the default is sized for file work alone, so a holder whose cycle includes a network round trip — a credential mutation that refreshes an expired token — states a longer one, because leaving the default would fail every other writer of that file for the duration. The retry cadence stays fixed. A contender removes an existing lock only when the lock names a process that no longer exists; file age alone never removes a lock.

### Failures to plan for

Windows retries one `EPERM` when the lock cannot be observed, because its holder can release between exclusive creation and the existence check. A repeated unconfirmed `EPERM` is rethrown without running the operation.

The lock's parent directory must already exist, so `withFileLock` rejects an invalid parent hierarchy before running the operation. A process that exits while holding the lock leaves the lock sibling behind, and the next writer takes it over. A lock or takeover claim whose record is empty or incomplete is taken over once its file is more than 30 seconds old, since a live writer finishes the record within microseconds; a fresh one is waited for. A lock that names a PID a live process reused is not taken over; later writers time out with `FileLockError` `FILE_LOCK_TIMEOUT`, which names the `lockPath`, and an operator removes it only after verifying that no writer still owns it. An optional `signal` cancels acquisition and contention waits; the operation owns cancellation after it starts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package is built on one separation: the atomic commit owns the swap, and the writer lock owns cross-process ordering.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `writeFileAtomic`, `withFileLock`, and `FileLockError`, the package's whole surface |

### Write path

`writeFileAtomic` writes a random-suffix sibling opened with exclusive create (`wx`), then renames it over the target. The exclusive open refuses to follow a symlink planted at a guessable temp path; the same-directory sibling keeps the rename on one filesystem; and the rename replaces a symlinked target itself instead of writing through to its referent. A Windows retry keeps the same complete sibling and uses bounded exponential backoff, so temporary use of the target by software outside the cooperative writer lock cannot turn a safe replacement into an immediate failure; the archived [retry decision record](../../../.agents/notes/archived/bug-fix/2026-08-29-windows-atomic-replace-retry.md) documents the original rationale and rejected alternatives.

`withFileLock` creates a `<filename>.lock` sibling with `wx`. `EEXIST` identifies contention directly; `EPERM` does so only when a fresh `lstat` confirms the lock path exists, covering Windows exclusive-create behavior without hiding an unrelated permission failure. The lock records its creator's PID as `<pid>\n` and is removed by the holder in a `finally`. A contender that reads a record whose PID a signal probe reports as absent (`ESRCH`) creates a `<filename>.lock.takeover-<record hash>` claim with `wx`, re-reads the lock and probes its PID again, removes it only if it still holds the same record and that PID is still absent, removes the claim, and retries at once. A claim records its claimant's PID; a contender that finds a claim whose claimant exited (or whose record stayed incomplete past 30 seconds) renames it to a unique tombstone, compares the tombstone with the record it judged stale, links a live contender's fresh claim back when the content differs, and retries. A holder that exists under another user (`EPERM`) and a record naming the contender's own process are waited for. Contenders that read the same record contend for one claim, and the second probe rejects a holder that reused the exited PID, so a takeover never removes a lock that another contender acquired after the exited holder's. Takeover proves only that the recorded process exited; an operation that starts other writers leaves its successor a way to find them, as the [Plugin Manager](../../boot/plugin-manager/README.md) does for its pnpm runs. Contention backs off exponentially and fails when the per-call `waitMs` deadline (default two seconds) passes; the [historical takeover decision record](../../../.agents/notes/archived/bug-fix/2026-09-24-exited-holder-lock-takeover.md) records the rationale.

### Why the swap stays safe

- **Fresh inode, caller-stated mode** — the temp carries `mode` through the rename, so narrowing a wider-permission file has no chmod race. `mode` is required so the permission decision stays visible at every call site.
- **Readers never contend** — the rename commit is atomic, so a reader needs no lock.
- **A contender deletes only an exited holder's lock** — age cannot distinguish a crashed owner from a paused live writer, but a missing process can.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you need the consuming stores or the family this primitive belongs to.

- [Profile configuration editor](../../boot/config-editor/README.md) — the profile patch every edit replaces through this package.
- [Credentials store](../../credentials/credentials-local/README.md) — the credentials file this package locks and replaces.
- [util group map](../README.md) — the utility family this package belongs to.

-----

<a id="model-experience"></a>
## Model Experience

None, as this is a pure filesystem write primitive that registers nothing model-facing.

#### KV Cache effect

Nothing here enters a request prefix, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where the package is not the right tool. They are current package constraints, not a task backlog.

- **Durable replacement is best effort** — the temp file is fsynced before the rename and the parent directory after it, but not on Windows (Node cannot open a directory there), not for parent directories this call created, and not on a filesystem that reports directory sync as unsupported. A directory sync failure after the rename throws `AtomicWriteSyncError` (`ATOMIC_WRITE_UNSYNCED`) although the new content is already published; a retry is harmless.
- **Callers supply complete content** — strings and `Uint8Array` (including `Buffer`) are accepted; streaming writes are unsupported.
- **Some orphaned locks require operator recovery** — a lock that names a PID a live process reused stays in place; later writers time out without deleting it, and the operator removes it after verifying that no writer runs. A contender that ends between creating a claim and removing the lock, or a writer that ends between creating a lock or claim and writing its PID, is recovered automatically (a dead claimant at once, an incomplete record after 30 seconds). Two residual windows remain: restoring a live contender's claim that a breaker renamed away is not atomic, and a live writer suspended for more than 30 seconds between creating and writing its record would lose its lock. Either can let two writers hold the lock at once; both need a process stalled or racing at the exact moment, and neither occurs in the crash cases the protocol targets.
- **Remote holders are never taken over** — the lock record names the holder's PID, host name and (on Linux) PID namespace. A contender probes only records written on its own host and namespace; a record from another host or container sharing the volume is waited for until `FILE_LOCK_TIMEOUT`, so a crashed remote holder's lock needs operator removal. A legacy record that names only a PID is still probed locally. Hosts that share a host name and have no `/proc` PID namespace link cannot be told apart.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Owner-only permissions on Windows remain the caller's responsibility (see the credentials-local DACL handling); the file and directory `fsync` are implemented in `writeFileAtomic`.

</details>
