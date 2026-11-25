# Claude subscription profiles

This optional local plugin adds **Settings → Claude accounts**. Enter a profile name, choose **Add account and sign in**, and finish Claude Code's authorization in your browser. Check the email under the profile name, then select a model from that profile's group in chat. The browser may reuse the current Claude.ai account. To add another subscription, select that account on Claude.ai before starting sign-in.

The default profile uses the local Claude Code login. Named profiles live under the Harness home in `claude-accounts`. The plugin identifies an account by the email and organization id that Claude Code reports, keeps one model route per account, and signs duplicate managed profiles out locally. The default profile takes priority and the settings page says so when it displaces a managed profile. Existing assignments survive a restart. On first use the oldest managed profile wins a tie.

Ownership is stored in `claude-accounts/.ownership.json` as an HMAC of the lowercased email and organization id, keyed by a random per-install secret in `claude-accounts/.ownership-secret`. Profile directories hold Claude credentials and are created with mode `0700` where the platform supports it. A registry file that cannot be read is copied to `.ownership.json.corrupt-<time>` and rebuilt.

A sign-in that is not finished within five minutes is stopped and reported as timed out. Set `DSH_CLAUDE_LOGIN_TIMEOUT_MS` (milliseconds, clamped to 1000 .. 2147483647; an invalid value uses the default) before starting the Harness to change that.

The notice about a managed profile displaced by the default profile is stored in the registry, so it survives a restart and disappears once that profile is signed in with another account. Other notices (duplicate sign-in, failed local sign-out) are kept until the settings page acknowledges that it showed them.

## Build and test

Use Node.js 24.9 or later, Git, and tar. Run the following commands in this directory. The bridge build fetches the pinned adapter from npm, checks its SHA-512 digest, and applies the Windows compatibility changes in `bridge.patch`.

```sh
npm ci --workspaces=false
npm test
npm pack
```

Offline runs, once `npm ci` has been done:

- `DSH_CLAUDE_BRIDGE_TARBALL=/path/to/dsh-plugin-claude-code-0.2.5.tgz npm test` builds the bridge from a local copy of the pinned tarball (the digest is still checked).
- `DSH_CLAUDE_BRIDGE_SKIP=1 npm test` skips the bridge build. The tests that need the bridge (`accounts.test.mjs`, `login.test.mjs`) are then reported as skipped unless `bridge/` already exists; the ownership and settings-page tests still run.

Install the resulting `dsh-claude-account-manager-1.1.1.tgz` as a local plugin bundle in a desktop profile for this fork's `0.2.2-rc.3` release. The desktop needs the official Claude Code executable. The bundle includes its main provider and the account manager. It owns the `claude-code-session` route and should be the only enabled plugin registering that route.

## Components

Model discovery and inference use the official Claude executable and Agent SDK through Shantanu Goel's adapter. The package includes the adapter's license in `bridge/LICENSE`. The settings page starts `claude auth login --claudeai`. Claude Code handles browser authorization and stores credentials. See [NOTICE.md](NOTICE.md) for the third-party components and their licenses. [Upstream Claude Code adapter](https://github.com/shantanugoel/dsh-plugin-claude-code)

The Harness request retry service allows up to three retries for transient Claude model failures, including provider overload and a tool stop without any published calls. It retries the failed model step using the recorded tool results. A native execution error with an unknown outcome still requires manual recovery.

## Limitations

- **Anthropic terms.** Whether Anthropic's terms allow using a Claude subscription through the Agent SDK this way, and distributing this plugin, has not been confirmed. NEEDS NOMAD.
- **Same-email ownership.** Two profiles are duplicates only when Claude Code reports the same email and the same organization id. If a profile's status carries no organization id it is keyed with an empty one, so it will not match a profile that does.
- **Host-side browser login.** `claude auth login` runs on the machine that runs the Harness host and opens the browser there. Signing in from a remote browser session is not supported.
- **Windows-focused patches.** `bridge.patch` fixes behavior of the pinned adapter on Windows. Other platforms use the adapter as published and are less exercised.
- **Version pinning.** The adapter (0.2.5), the Agent SDK (0.3.322), and the Harness packages (`0.2.2-rc.3`, including `engines.dsh`) are pinned to exact versions. Upgrading any of them means updating the digest in `prepare-bridge.mjs`, re-checking `bridge.patch`, and re-running the tests.
- **First-use race.** If two Harness processes first create or replace `.ownership-secret` at the same moment, one of them can keep using a different secret until it restarts; its ownership entries are then treated as new accounts and reassigned.
- **Notices.** The one-shot notice is global across open settings tabs, and a repeat of identical text while it is still set is not announced again.
- **No CI lane.** The repository's gates and CI do not build or test this directory. Run `npm test` here by hand.
- **Adapter license.** The adapter is MIT-licensed according to the npm metadata and the tarball's `LICENSE`; the upstream repository was not checked. The Agent SDK is proprietary (see NOTICE.md).
- **English only.** The settings page and the messages from the host side are English. Whether an out-of-tree browser bundle can use the Harness locale service was not verified, so no translations are provided.
