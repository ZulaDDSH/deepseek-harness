---
description: "Anonymous per-harness-home identity for users and maintainers tracing how telemetry, feedback acknowledgement, and DeepSeek provider requests correlate records."
kind: "package-library"
---

# @deepseek-ai/dsh-anonymous-user-id

## Summary

DeepSeek Harness uses one anonymous identifier per harness home to correlate telemetry, feedback, and DeepSeek requests from the same installation without identifying the user. The random UUID is stored in `$DSH_HOME/.anonymous-user-id` (`$DSH_HOME` defaults to `~/.dsh`), persists across restarts, and is regenerated after you delete the file. Different harness homes use different identifiers, and the value contains no machine or account data. Built-in features create and attach it automatically; package consumers can reuse the same value for installation-scoped correlation, but cannot join records across homes.

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

When you want the records your installation sends out to be recognizable as coming from the same harness home — telemetry, feedback, and DeepSeek requests all carry one shared id — this package is what provides it. There is nothing to install or configure: the id appears automatically, and the shipped feedback, telemetry, and DeepSeek features already use it. Do not use it to identify a user or to join records across different homes; it is anonymous and home-scoped.

### What the id does for you

Three things your installation sends out carry the same id, so records line up across all of them:

- **Session telemetry** — your telemetry exports carry the id as the `user.id` resource attribute, so a collector can group an installation's records.
- **Feedback** — each feedback acknowledgement names the anonymous installation that recorded it.
- **DeepSeek requests** — every provider request carries the `x-deepseek-harness-user-id` header, so usage can be attributed per installation.

### Observing and resetting the id

The id lives in `$DSH_HOME/.anonymous-user-id` (`$DSH_HOME` defaults to `~/.dsh`) as a plain UUID text file. Delete that file to get a fresh id at the next launch; the running process keeps its current id until it exits. Separate harness homes keep separate ids, and no machine or account detail ever goes into the value.

### Using it in your own package

When you build a feature that should share the installation's anonymous id, import the value once and reuse it — telemetry, feedback, and DeepSeek already use the same id, so your records line up with theirs:

```ts
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'

const userId = getOrCreateAnonymousUserId() // stable for the process lifetime
```

The value is stable for the process and matches what the built-in features use; it changes only when the file is deleted and a later launch mints a replacement. Even when the home directory cannot be written, the value still works for the current run, so records keep flowing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Random, never derived.** The id comes from `crypto.randomUUID()`; it is never derived from the hostname, network address, git remote, or any other identifying source, so anonymity is a property of the mint.
- **Synchronous and memoized.** One process touches each resolved file path once: reads and writes are synchronous, and the result is memoized per resolved file path.
- **Best-effort persistence.** A write failure still returns a usable id for the run, so telemetry and feedback never block on an unwritable home.
- **Library, not plugin.** There is no Cordis plugin entry or config.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Library entry: `getOrCreateAnonymousUserId`, file persistence, per-path memoization |
| [`tests/anonymous-user-id.spec.ts`](tests/anonymous-user-id.spec.ts) | Exercised behavior: mint, persistence, corruption, concurrency, memoization |

### The API

The package exposes one function that returns the installation's anonymous id, minting and persisting it on first use; the exact signature, options, and defaults live in `src/index.ts`.

### Storage contract

The file is a bare UUID line named by `ANONYMOUS_USER_ID_FILE_NAME`, validated against a UUID pattern on read. Minting and repairing the file happen under an exclusive-create `.anonymous-user-id.lock` file next to it: the process rereads under the lock, adopts a valid id another process published, and otherwise writes a temp file and renames it over the id file, so readers never see a partial id. A corrupt or empty file is repaired the same way. The wait for the lock is bounded (2 seconds by default, `lockTimeoutMs`), and a lock older than 10 seconds is treated as stale and removed. On a timeout the process adopts a valid persisted id or uses a fresh id in memory without writing; an unwritable home also yields an in-memory id. Memoization is keyed by resolved file path, so distinct homes never share an id.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the identity group map to the home-path resolution this package builds on and the features that use the id.

- [identity group map](../README.md) — the sibling packages and group scope.
- [dsh-home-paths](../../util/home-paths/README.md) — owns `$DSH_HOME` and `~/.dsh` resolution.
- [dsh-session-telemetry-otel](../../session/session-telemetry-otel/README.md) — reports the id as the OTel Resource `user.id`.
- [dsh-command-feedback](../../feedback/command-feedback/README.md) — embeds the id in the feedback acknowledgement.
- [dsh-llm-deepseek](../../llm/llm-deepseek/README.md) — sends `x-deepseek-harness-user-id` on provider requests.
- [Session telemetry subsystem](../../../docs/subsystems/session-telemetry.md) — the telemetry seam and its backend contract.

-----

<a id="model-experience"></a>
## Model Experience

None, as the shared identifier reaches DeepSeek only as model-hidden HTTP metadata and registers nothing model-facing.

#### KV Cache effect

None; the transport header changes neither tokens nor the model-visible prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits describe when the id is a poor fit or needs special attention. They are current package constraints, not a general comparison of anonymity approaches or a task backlog.

- **No recovery after deletion** — losing the file mints a new anonymous identity by design; recovery would require stable derivation material that weakens anonymity.
- **Best-effort concurrency** — creation and repair are serialized by a lock file, so concurrent launches converge on one persisted id. A process that cannot get the lock within the timeout, an unwritable home, or two processes removing the same stale lock at once can leave a process with a different in-memory id for that run; later launches converge on the persisted value.
- **No cross-home identity** — different `$DSH_HOME` values cannot be correlated.
- **Configured DeepSeek gateways receive the id** — `dsh-llm-deepseek` sends the stable header to its resolved `baseURL`, including deployment overrides, independently of telemetry sharing mode.
- **Deleting the file does not reset the current process** — memoization keeps the run's id until the next launch.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above and the package code, and conclusions migrate there once they stabilize.

#### Open: file-format evolution

The persistence contract is a bare UUID line with no version marker. Adding a second value beside the id, or wrapping the line in a container, has no migration story for existing files; a versioned line format is one way to make such a change safe.

</details>
