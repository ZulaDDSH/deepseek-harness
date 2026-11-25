# Auto Auditor

Auto Auditor reviews Git changes while the Harness host runs, including when the sidebar tab is closed. In a lead chat, ask to send a GitHub pull request to Auto Auditor and include the URL or PR number. The lead can include evidence such as test results, timings, or paths to before-and-after images. A local commit range also works.

Auto Auditor reads the PR through a matching configured Git remote and pins the reviewed commit. Its verdict and answers appear in the originating chat and in the Auto Auditor review inbox. Ask a question with `auditor_message` or check the review with `auditor_status`. Master Control can also read and discuss any review or submit a PR on behalf of a lead. If the auditor asks for a run, the slot request goes to Master Control.

Open **Review queue** in Master Control for the latest audit on each submitted PR or lead branch. Select a review to open its findings in Auto Auditor. Install the optional GitHub review status plugin and connect the PR repository to add live GitHub status and required checks.

With GitHub review status enabled, ask a lead or Master Control to use `auditor_push_and_review` for an existing open PR. Supply the expected PR head and the exact local commit. The tool pushes through the worktree’s configured Git remote, then audits the confirmed commit. Retry a pending audit with the same arguments.

After changes are requested, the lead can use `auditor_stage_fix` to submit a local repair against the original PR revision. Master Control can also submit a chosen PR Fixer session’s repair commit. With permission to publish, Master Control uses `auditor_publish_fix` to push the approved commit to the original PR branch. Publication requires Full access and Git push permission for that branch.

The queue survives a Harness restart. An approval applies to the recorded commit and base. Submit a follow-up after they change. If the remote lacks a test-merge ref, provide the PR’s target branch or base SHA. The review is local to the Harness and uses the configured reviewer model. A dedicated provider, model, and effort can be set in **Reviewer model**.

Run `npm pack` in this directory and add the tarball with `dsh plugin --profile desktop add <tarball>`. This contribution targets the Harness `0.2.2-rc.5` desktop runtime and uses Git on the host’s PATH.
