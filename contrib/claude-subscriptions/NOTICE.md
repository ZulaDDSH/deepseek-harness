# Third-party notices for claude-subscriptions

This directory is not part of the pnpm workspace, so the repository's generated `THIRD_PARTY_NOTICES.md` does not list it. This file records what the plugin builds on. Facts below were checked on 2026-11-23 against the npm registry; the items marked NEEDS NOMAD are decisions code cannot make.

## Claude Code adapter (fetched and patched at build time)

| Field | Value |
| --- | --- |
| Package | `dsh-plugin-claude-code` 0.2.5 |
| Author | Shantanu Goel |
| Source | https://github.com/shantanugoel/dsh-plugin-claude-code |
| Fetched from | `https://registry.npmjs.org/dsh-plugin-claude-code/-/dsh-plugin-claude-code-0.2.5.tgz` by `prepare-bridge.mjs`, or from the file named by `DSH_CLAUDE_BRIDGE_TARBALL` |
| Integrity | SHA-512 `RXFa0WKsiYoC+VbjPSWdgGNK0btoh+RyHsMZwFlvZHnSNsYST86AdyrrxFQnlqQH2mxkEli+iiYjqT0DJizMZw==` (the build fails on a mismatch; it equals the registry's `dist.integrity`) |
| License | MIT, "Copyright (c) 2026 Shantanu Goel". The npm metadata and the `LICENSE` file inside the tarball both say MIT. The upstream repository itself was not inspected. |
| Local changes | `bridge.patch` (Windows environment variables, byte-order mark handling, executable lookup, provider display names). It applies cleanly to the tarball. |

The build copies the tarball's `LICENSE` to `bridge/LICENSE`, and `npm pack` ships it with the bridge. The MIT terms require keeping that notice with copies of the adapter; do not strip it.

## Claude Agent SDK (runtime dependency)

| Field | Value |
| --- | --- |
| Package | `@anthropic-ai/claude-agent-sdk` 0.3.322 (exact pin in `package.json` and `package-lock.json`) |
| Registry license field | `SEE LICENSE IN README.md` |
| `LICENSE.md` text | "© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance." |

This is not an open-source license. The SDK is not copied into this repository or into the packed plugin; the package manager installs it from npm. Its README points to Anthropic's Commercial Terms of Service and Privacy Policy.

NEEDS NOMAD: confirm that Anthropic's terms allow driving Claude Code with a consumer subscription login through the Agent SDK in this way, and that distributing this plugin to other users is acceptable. Nothing in this repository settles that.

## Other runtime dependencies

`@deepseek-ai/schemastery` and `zod` are used by the adapter bridge (`bridge/index.js`, `bridge/sdk-schema.js`). `@deepseek-ai/dsh-atomic-write` is used by `ownership.js`. Their licenses are recorded in `package-lock.json`; they were not individually re-read for this notice.
