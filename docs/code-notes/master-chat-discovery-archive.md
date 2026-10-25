# Master Control discovery and archive

`packages/client/ui-master-control/src/client/MasterControlCenter.tsx:MasterControlCenter` hosts the existing Conversation slot under an explicitly retained master-home Session reference beside the session dashboard. The reference is released on unmount, failed acquisition, or a late response after navigation. `packages/client/ui-master-control/src/client/index.ts:apply` registers this control center as the Master Control main panel; the old action that opened the home as an ordinary workspace conversation is removed. `packages/client/ui-workspace/src/client/tree.ts:sessionVisible` excludes reserved master-home identities from ordinary chat lists; their durable history remains available inside the control center.

`packages/api/session-controller/src/external-chats.ts:ExternalChats.read` streams a snapshot of each JSONL file and retains only supported conversation text and parent-chain metadata. The text budget remains 16 MiB; source files are not rejected merely because tool output makes them larger. Complete malformed records still reject; an unfinished final write is retried on the next refresh. Discovery keeps every candidate within the bounded directory scan and caches previews by file size and modification time.

`packages/client/ui-master-control/src/client/MasterControlPage.tsx:MasterControlPage` refreshes external discovery and imports missing chats in batches while the page is open. Source modification times classify imported copies by actual source activity rather than the date the copy was created. Import errors remain visible. Imported histories are copies; controls and running status continue to describe DSH activity, not the external Claude process.

`packages/client/ui-master-control/src/client/rows.ts:masterRows` places idle chats with no activity for at least seven days in the Archive view. Running, failed, and attention rows remain active. The view also includes the Workspace registry's manually archived sessions. This reversible view policy does not delete transcripts or interrupt external agents; new activity automatically returns an aged row to the active list.

`packages/api/session-controller/src/master-control.ts:MasterControlSessions.importOne` prepares, enters, flushes, and detaches a temporary Session without creating an Agent. Bulk import therefore does not keep one live agent and its complete transcript in memory for every discovered chat. The ordinary Session resume path loads a copy when opened.

`packages/api/session-controller/src/master-control.ts:MasterControlSessions.importOne` uses the user's home directory when an old source project no longer exists. The external catalog still reports the original project path; the original transcript is not changed.

`packages/api/session-controller/src/master-control.ts:externalHistory` stamps imported event envelopes with the source activity time; `MasterControlSessions.importOne` also preserves that instant in the reconstructed Session header. The ordinary cold and live list projection can then preserve source age, and later DSH prompts advance it normally. `packages/client/ui-master-control/src/client/rows.ts:masterRows` uses the newer of source and DSH activity, so continuing a copied conversation does not leave it archived by its old external timestamp.

## Quota prompt suppression

packages/client/ui-provider-quota/src/client/usage-prompt.ts:isDismissed treats a live dismissal as provider-wide until its recorded reset or one-day open-window expiry. This prevents sibling windows and refreshed reset timestamps from immediately replacing a dismissed banner, reuses persisted keys without migration, and leaves other providers unaffected. usagePrompt ignores expired quota windows until fresh data arrives. Regression proof: usage-prompt.client.spec.ts failed both scenarios before the change; quota suite verifies the corrected behavior. No billing credentials or provider selection changes.


## Hook argument forwarding

packages/hooks/hooks-codex/src/index.ts:preToolPayload and postToolPayload pass exec.arguments unchanged to tool_input. The command-only projection discarded file paths and replacements, causing agent-guards.mjs to reject Edit/Write and patch calls as missing a target or patch. No global guard or guard configuration is changed. packages/hooks/hooks-codex/tests/bridge.spec.ts captures both hook events through the existing RecordingShell; the edit, write, and patch cases failed against the original bridge, then passed with complete arguments. Native shell argument preservation and empty replacements are covered too. Existing command-only coverage expectations were corrected to preserve original values rather than coercing them.
