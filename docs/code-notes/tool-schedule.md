# tool-schedule code notes

## packages/schedule/tool-schedule/src/index.ts:registerScheduleTools (issue 61)

The four tools used to reach every Host task: any agent with them could list other Sessions' prompts and edit or delete their tasks by id, with only prompt guidance as the check. The Host service records `involvedSessionIds` on each task (the creating or editing Agent's Session plus the target Session), which is the ownership information available without a schema change.

Fix: unless the plugin is mounted with `administrator: true`, a tool call reaches only tasks whose `involvedSessionIds` include the calling Agent's Session. `schedule_list` fetches the Host catalog, filters it, and pages the filtered set, so `total` and `shown` count only visible tasks. `schedule_view` and `schedule_edit` answer `schedule_not_found` for a task the caller is not involved in, the same answer as an absent id, so a refused id does not disclose that the task exists. Involvement only grows (edits add the editor, nothing removes it), so a task visible when checked stays visible when the edit runs; no lock is needed. `schedule_create` is unchanged and makes the caller involved.

The administrator role is deployment-level: a preset opts in by mounting the plugin with `administrator: true`, which restores Host-wide management for that scope. A task created by a human or Remote caller without a target Session has no involved Session, so only an administrator mount (or the Host UI) manages it. The service itself (`ScheduleService`) is unchanged and still trusts its callers; the check lives in the model-facing tools, which are the untrusted entry point.
