---
description: "Git repository resolver for maintainers registering a Git checkout as a knowledge source, pinning it to the exact commit a knowledge server ingests from."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-source-git

## Summary

This package resolves a Git repository and ref into a local checkout a knowledge service can ingest, and reports the exact commit the checkout now points at. A public GitHub repository is cloned with ordinary Git semantics; a local checkout is fetched and moved in place only while it carries no uncommitted tracked changes. The resolved commit is the source record a knowledge entry keeps, because a knowledge service that only ingests files records a path and a source type, never the revision a document came from. This package is a resolver, not a running service.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Call `resolveGitSource` with a repository, ref, and the paths you plan to ingest before pointing a knowledge service's index configuration at the result.

```ts
import { resolveGitSource, listSourceFiles } from '@deepseek-ai/dsh-knowledge-source-git'

const resolved = await resolveGitSource({
  repo: 'my-org/garden-knowledge',
  ref: 'master',
  paths: ['docs/**', 'knowledge/**', 'decisions/**'],
})
// resolved.root   — local checkout path to point the knowledge service's index directories at
// resolved.commit — full commit SHA to record alongside every ingested document

const files = await listSourceFiles(resolved, ['docs/**', 'knowledge/**'])
```

### When to choose it

Choose it when a knowledge source is a Git repository — public GitHub or a local checkout — and you need the exact commit a document came from, not only its file path. Skip it for a knowledge source that already has its own version tracking, or for local material with no Git history to pin against.

### Repository forms accepted

| `repo` value | Resolved as |
|---|---|
| `owner/name` | `https://github.com/owner/name.git`, cloned |
| a URL (`https://…`, `git@…`) | passed to Git unchanged, cloned |
| an absolute or relative path | used as an existing local checkout; must already be a Git work tree |

A private repository is never given credentials by this package: cloning and fetching run through the ordinary system Git, so host-side credential configuration — an SSH key, a credential helper, an already-authenticated environment — is what makes a private clone succeed. No token is read from or written to a knowledge record.

### What you get

`resolveGitSource` clones a new remote repository, or fetches an existing one, resolves the configured ref to a commit, and returns the checkout root plus that commit SHA. The fetched remote-tracking revision is what a branch ref resolves to, so a repeated call after the upstream repository advances returns the new commit rather than the commit the local branch was left at; a knowledge sync process comparing the returned commit against a stored one can therefore detect that the source changed. `listSourceFiles` reports exactly the tracked files the configured pathspecs select, using Git's own pathspec matching so `**` behaves as Git defines it.

A checkout already standing at the resolved commit is left untouched, so a local checkout keeps its branch and its uncommitted work whenever the ref has not moved. When the ref would move a local checkout that carries uncommitted tracked changes, `resolveGitSource` rejects instead of checking out over them; point the source at a separate clone, or commit and stash the work, to sync that repository.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the resolver and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Ordinary Git clone and fetch, not a bespoke sync protocol.** The resolver shells out to the system `git` binary for `clone`, `fetch`, `checkout`, and `rev-parse`; no repository-format parsing or storage code exists in this package.
- **The commit is the fact a knowledge record cannot recover on its own.** A knowledge service that only records a file path and source type cannot say which revision a document came from; this package exists specifically to supply that one missing fact.
- **No credential handling.** The child environment starts from the subprocess seam's `scrubbedParentEnv()`, so credential-shaped ambient variables are dropped before Git runs; a private repository succeeds only through Git's own credential mechanisms (SSH agent, credential helper, git config), never through a value this package reads or stores.
- **Idempotent resolution.** Resolving the same source twice against an unchanged upstream returns the same commit; resolving after the upstream advances returns the new one — the return value is the single fact a caller needs to detect drift.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `resolveGitSource`, `listSourceFiles`, `cloneSource`, and the Git subprocess helpers |
| — | No runtime invariant companion is published; every operation is a synchronous request/response against an external Git process with no independent server-side state a companion could diverge from. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this resolver to the knowledge server it feeds and the policy governing how agents use what it ingests.

- [Knowledge policy package](../knowledge-policy/README.md) — the global rule agents follow when retrieving knowledge this source contributes.
- [MCP client package](../../mcp/mcp-client/README.md) — configuring the Streamable HTTP knowledge server entry that ingests the checkout this package resolves.
- [Shared knowledge MCP service Agent Note](../../../.agents/notes/implemented/architecture/2026-09-21-shared-knowledge-mcp-service.md) — the full architecture decision, alternatives, and consequences.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits describe what this package does not do. They are current package constraints, not a task backlog.

- **No scheduling or watching** — this package resolves a source once per call; a periodic sync, a webhook trigger, or a file watcher are the caller's responsibility.
- **No knowledge-service ingestion call** — this package stops at producing a checkout and a file list; sending that list to a knowledge service's index tool is a separate integration step.
- **Shallow clone is not used** — every clone is a full clone, which is simple and correct but slower than a shallow clone for a large repository with long history.
- **Local checkout must already be a Git work tree** — a plain directory of files with no `.git` is rejected rather than initialized.
- **A moved local checkout must be clean** — resolving a ref that would move a local checkout with uncommitted tracked changes is rejected; syncing that repository needs a clean tree or a separate clone, because this package never discards the operator's edits.
- **No submodule handling** — a repository with submodules resolves its top-level tree only.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

- Shallow clone support (`--depth`) is a plausible follow-up once a large-repository consumer needs it; today every clone is full to keep `rev-parse HEAD` and ref resolution unconditionally correct.
- A scheduled sync loop is intentionally out of scope for the first knowledge-service integration; see the [Shared knowledge MCP service Agent Note](../../../.agents/notes/implemented/architecture/2026-09-21-shared-knowledge-mcp-service.md) for the phased scope this package was built under.

</details>
