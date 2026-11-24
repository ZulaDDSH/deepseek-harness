---
description: "Run Desktop publication and staged rollout from retained packages without installing Desktop build dependencies."
kind: "package-library"
---
# Desktop publisher

## Summary

Publish retained Desktop packages, change an existing release's rollout percentage, and refresh website installers. The manual GitHub workflows select the original packaging machine and require the configured environment approvals. This private workspace shares the repository lockfile and runs TypeScript source directly with Node 24 and tsx.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Limitations](#limitations)

## Use this package

This revision does not track the GitHub Actions workflows that dispatch packaging, retention, publication, or rollout (`windows-package.yml`, `macos-package.yml`, `macos-intel-package.yml`, `desktop-publish.yml`, `desktop-rollout.yml`); `.github/workflows/ci.yml` runs only this package's checks. The tools below are driven by the scripts under `apps/desktop/scripts` (`retain-desktop-ci.ts`, `publish-desktop-ci.ts`, `rollback-desktop-channel.ts`, `verify-retained-desktop.ts`) and the entrypoints in this package, run by an operator or by workflows maintained outside this revision. Runner routing, credentials, and approval steps belong to those external workflows; guides that link the workflow files describe a process this revision cannot dispatch. Rollout installs only this workspace's production dependencies with lifecycle scripts disabled; invoke its entrypoints with Node from this package directory to avoid pnpm's automatic dependency repair.

The dependency-free preflights run before installation. Their executable regression check is:

```sh
node apps/desktop-publisher/tests/preinstall.mjs
```

## Implementation

<details>
<summary>Maintainer details</summary>

Desktop build and signing scripts stay in `apps/desktop`; publishing code imports no Desktop implementation. Desktop consumes publisher helpers through the workspace package exports. Runtime dependencies belong in this package's `dependencies`; tests and type checking use repository development tools. The root host TypeScript project checks this source, so there is no separate emitted package or package-local tsconfig.

Full-install publication and filtered-install rollout use different checkout directories. Changing install modes in one checkout removes development dependency links and can retain stale Desktop directories. Release records live outside these checkouts and remain owned by the existing retained-release configuration.

Tests under `apps/desktop` may reuse the publisher's loopback COS fixture. Publisher failure tests also exercise the Desktop rollback and archival CLIs as repository integration tests; these test-only paths are not runtime dependencies. The isolated-install CI checks load publisher source without Desktop or root development dependencies on Linux, macOS, and Windows, and contribute to required CI verdicts.

</details>

## Limitations

- This private tool is not published to npm and does not generate a standalone artifact. Workflow checkouts must contain the shared lockfile and workspace metadata.
- The channel lock under the runner's release root serializes writers on one machine only. Publishers on different machines that share a bucket and channel are not coordinated, and the feed preflight is a read followed by an unconditional write, so concurrent cross-machine publication can overwrite a newer feed. Serialize such releases externally; routing dispatches publication to the original packaging machine, and no remote conditional write is implemented.
- Retention recovers an abandoned claim only when its owner process on the same host is gone or an ownerless claim is older than one minute; a claim held by another host or a live process must be inspected by the operator.
- Isolated-install and preflight tests do not authorize a production write or prove that an installer upgrades a real client.

### Dev Note

None.
