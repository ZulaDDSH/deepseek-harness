# Auto Auditor

Auto Auditor reviews Git changes while the Harness host runs, including when the sidebar tab is closed. In a lead chat, ask to send a GitHub pull request to Auto Auditor and include the URL or PR number. The lead can include evidence such as test results, timings, or paths to before-and-after images. A local commit range also works.

Auto Auditor reads the PR through a matching configured Git remote and pins the reviewed commit. Its verdict and answers appear in the originating chat and in the Auto Auditor review inbox. Ask a question with `auditor_message` or check the review with `auditor_status`. Master Control can also read and discuss any review or submit a PR on behalf of a lead. If the auditor asks for a run, the slot request goes to Master Control.

Open **Review queue** in Master Control for the latest audit on each submitted PR or lead branch. Select a review to open its findings in Auto Auditor. Install the optional GitHub review status plugin and connect the PR repository to add live GitHub status and required checks.

With GitHub review status enabled, ask a lead or Master Control to use `auditor_push_and_review` for an existing open PR. Supply the expected PR head and the exact local commit. The tool pushes through the worktree’s configured Git remote, then audits the confirmed commit. Retry a pending audit with the same arguments.

Open **PR Fixer** directly below **Auto Auditor** in the sidebar to see the repair inbox for PR reviews with changes requested. Each work order displays the PR link, exact starting commit SHA, Auto Auditor findings, and any reported lead evidence. Configure a profile-wide provider, model, and reasoning effort in **Fixer model** (defaulting to the audit model and effort). **Automatic wake** defaults to off; when enabled, Auto Auditor starts PR Fixer automatically for new PR verdicts that request changes, without waking recursively on repair re-reviews.

Starting a repair from PR Fixer, via Automatic wake, or from Master Control with `auditor_send_to_fixer` verifies that the live PR head matches the reviewed commit, prepares an isolated detached Git worktree at that SHA, opens a per-review repair chat, and sends one handoff containing the PR link, starting commit, findings, source review ID, and lead context. The assigned repair chat, the originating lead, or Master Control commits the repair locally and submits that exact commit SHA to Auto Auditor with `auditor_stage_fix`. With owner authorization and Full access, Master Control uses `auditor_publish_fix` to push the approved repair commit to the original PR branch under an exact-head lease; merging remains a human decision.

The queue survives a Harness restart. An approval applies to the recorded commit and base. Submit a follow-up after they change. If the remote lacks a test-merge ref, provide the PR’s target branch or base SHA. The review is local to the Harness and uses the configured reviewer model. A dedicated provider, model, and effort can be set in **Reviewer model**.

Run `npm pack` in this directory and add the tarball with `dsh plugin --profile desktop add <tarball>`. This contribution targets the Harness `0.2.2-rc.5` desktop runtime and uses Git on the host’s PATH.
