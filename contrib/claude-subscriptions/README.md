# Claude subscription profiles

This optional local plugin adds **Settings → Claude accounts**. Enter a profile name, choose **Add account and sign in**, and finish Claude Code's authorization in your browser. Check the email under the profile name, then select a model from that profile's group in chat. The browser may reuse the current Claude.ai account. To add another subscription, select that account on Claude.ai before starting sign-in.

The default profile uses the local Claude Code login. Named profiles live under the Harness home in `claude-accounts`. The plugin recognizes the email reported by Claude Code, keeps one model route per account, and signs duplicate managed profiles out locally. The default profile takes priority. Existing assignments survive a restart. On first use the oldest managed profile wins a tie.

## Build and test

Use Node.js 24.9 or later, Git, and tar. Run the following commands in this directory. The bridge build fetches the pinned adapter from npm, checks its SHA-512 digest, and applies the Windows compatibility changes in `bridge.patch`.

```sh
npm ci --workspaces=false
npm test
npm pack
```

Install the resulting `dsh-claude-account-manager-1.1.0.tgz` as a local plugin bundle in a desktop profile for this fork's `0.2.2-rc.3` release. The desktop needs the official Claude Code executable. The bundle includes its main provider and the account manager. It owns the `claude-code-session` route and should be the only enabled plugin registering that route.

## Components

Model discovery and inference use the official Claude executable and Agent SDK through Shantanu Goel's MIT-licensed adapter. The package includes the adapter's license in `bridge/LICENSE`. The settings page starts `claude auth login --claudeai`. Claude Code handles browser authorization and stores credentials. The account manager stores profile ownership by hashed normalized email. [Upstream Claude Code adapter](https://github.com/shantanugoel/dsh-plugin-claude-code)
