# GitHub Review Status

This optional plugin adds GitHub PR and CI status to Master Control’s Review queue. After a lead submits a GitHub PR to Auto Auditor, open **Settings → GitHub review status** and connect its repository using a fine-grained GitHub token with access to that repository and read permissions for Pull requests, Contents, Checks, and Commit statuses.

The token stays in the Harness credential store. The host reads GitHub for reviews on the current queue page and shares recent results across clients. An approved revision becomes **Ready for review** when its head and target still match and GitHub confirms the required checks. A check that has not reported or a ruleset whose result cannot be verified stays **Unverified**. Links to failed GitHub checks are shown when available.

The plugin supplies read-only PR source-branch details to Auto Auditor’s existing-PR workflow. Publishing uses the worktree’s Git credentials and verifies the exact destination branch, expected head, and candidate. The GitHub token is used only for reads.

Open **PR Fixer** between Auto Auditor and Plugins in the sidebar. The panel reuses the one existing chat named PR Fixer when there is an exact match. You can also link a different chat or create one in a workspace. The panel opens the same conversation and keeps its model picker and history.

Run `npm pack` in this directory and add the tarball with `dsh plugin --profile desktop add <tarball>`. This plugin targets the Harness `0.2.2-rc.5` desktop runtime.
