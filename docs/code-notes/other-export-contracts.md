### `packages/api/session-controller/src/catalog.ts:missingCredentialProvider`
- `description`: Checks whether a provider's configured API-key reference currently resolves to a configured credential.
- `params.ctx`: Host context providing credential services and provider settings.
- `params.provider`: Provider route id to inspect.
- `returns`: True when the provider has a named API-key reference with no configured credential; false for providers without such a reference.

### `packages/api/session-controller/src/client/sessions/session.ts:Session.configureSubagent`
- `params.parentAvailable`: Whether the addressed parent Agent is available, used to update this Session's subagent transport state.

### `packages/api/session-controller/src/client/sessions/session.ts:Session.handleSubagentParentAvailable`
- `description`: Updates the cached availability of a subagent's parent Agent and notifies snapshot observers when it changes.
- `params.available`: Whether the parent Agent is currently available.

### `packages/api/session-controller/src/index.ts:SessionController.teamRoleDefaultOf`
- `description`: Resolves the effective fixed route for a Team role from the Session's inherited subagent setup.
- `params.session`: Session whose setup and ancestor chain provide the role route.
- `params.role`: Team role whose fixed route is requested.
- `returns`: The configured fixed route, or undefined when no fixed route is available.

### `packages/api/session-controller/src/index.ts:SessionController.missingCredentialProvider`
- `description`: Checks whether a provider route has a named API-key reference without a configured credential.
- `params.provider`: Provider route id to inspect.
- `returns`: True when its credential is missing; false when the provider has no named API-key reference or its credential is configured.

### `packages/api/session-controller/src/run-options.ts:runOptionsProjection`
- `description`: Defines the per-Session run-options projection, storing the latest run-options event and exposing its current value on the wire.

### `packages/api/session-controller/src/subagent-setup.ts:SUBAGENT_TEAM_ROLES`
- `description`: Ordered Team delegation roles that can receive fixed subagent routes.

### `packages/api/session-controller/src/subagent-setup.ts:SubagentTeamRole`
- `description`: Union of the Team delegation role names accepted by the session controller.

### `packages/api/session-controller/src/subagent-setup.ts:SubagentTeamRoleRoute`
- `description`: Route shape selecting either a Claude CLI model or an LLM provider model for a Team delegation role.

### `packages/api/session-controller/src/subagent-setup.ts:subagentTeamRoleRouteOf`
- `description`: Reads a Team role's fixed route from an enabled, schema-valid subagent setup.
- `params.value`: Candidate setup value to validate.
- `params.role`: Team role name to look up.
- `returns`: The role's fixed route, or undefined when the setup is invalid, disabled, the role is unknown, or its setting is not fixed.

### `packages/api/session-controller/src/team-role-defaults.ts:teamRoleDefaultOf`
- `description`: Resolves a Team role's fixed route from the nearest Session setup, then the global default at the root.
- `params.ctx`: Host context providing Session projections and loaded Session lookup.
- `params.session`: Starting Session whose setup or ancestors are searched.
- `params.role`: Team role whose route is requested.
- `params.globalDefault`: Candidate global setup used when the root Session has no setup.
- `returns`: The route from the nearest Session with a setup, or the global default at the root only when no Session setup is present; undefined when the selected setup has no fixed route; throws if an ancestor is unavailable or the chain exceeds eight Sessions.

### `packages/client/ui-chat/src/client/contract/process-groups.ts:RunningProcessActivity`
- `description`: Process activity category that can represent a live running tool, excluding the context-only category.

### `packages/client/ui-chat/src/client/contract/process-groups.ts:activity`
- `description`: Maps a tool name to its display activity category using the Chat process-group naming rules.
- `params.name`: Tool name to classify.
- `returns`: The matching running activity category, or the general tools category when no specialized name matches.

### `packages/client/ui-chat/src/client/contract/process-groups.ts:ProcessActivitySummary`
- `description`: Aggregated activity counts, targets, live task detail, and write/edit line totals for one process group.

### `packages/client/ui-chat/src/client/conversation-nodes/process-activity.ts:processActivity`
- `description`: Aggregates unique process activities, changed-file targets, line totals, and the latest running activity with bounded detail.

### `packages/client/ui-settings-account/src/index.ts:Config`
- `description`: Account settings client configuration containing the public contact questionnaire URL and source value.

### `packages/client/web/src/boot.ts:AppWebEntry.setBootHint`
- `description`: Replaces the text shown on the boot page to identify the current startup phase.
- `params.text`: Startup hint to display.

### `packages/llm/llm-pi-ai/src/stream.ts:toStreamChunks`
- `params.onUsageAboveWindow`: Optional callback invoked with input-token usage when a successful stop or tool-call result exceeds the resolved context window.
- `params.prefixDigest`: Optional digest of the request prefix recorded in replay state for the completed turn.

## Account notification contracts

### `packages/credentials/deepseek-account/src/index.ts:DeepSeekAccount.getNotifications`
- `description`: Queries unconsumed notifications in server order without reading profile data.
- `params.client`: Identity of the requesting UI; its language selects the server-authored message.
- `returns`: Notifications with their next query delay, or null when the account grant is absent or changed.

### `packages/credentials/deepseek-account/src/index.ts:DeepSeekAccount.getNotificationContent`
- `description`: Queries localized content for a notification, including one already consumed.
- `params.id`: Notification whose content is requested.
- `params.client`: Identity of the requesting UI; its language selects the localized content.
- `returns`: Content without changing consumption, or null when the account grant is absent or changed.

### `packages/credentials/deepseek-account/src/index.ts:DeepSeekAccount.reportNotificationEvent`
- `description`: Reports a notification interaction; Platform decides whether the notification is consumed.
- `params.id`: Notification the user interacted with.
- `params.event`: Displayed frame, non-dismiss action click, or explicit dismissal.
- `params.client`: Identity of the requesting UI for this call.
- `returns`: True when Platform accepts the event; false when the account grant is absent or changed.

### `packages/api/session-controller/src/subagent-setup.ts:SubagentRoleSetting`
- `description`: Defines a fixed route for a configured subagent role.

### `packages/client/ui-settings-models/src/client/search-entries.ts:modelsSearchEntries`
- `description`: Builds localized search entries for the Models settings page.

### `packages/subagent/tool-subagent/src/index.ts:CLAUDE_CLI_PROVIDER`
- `description`: Names the default Claude Code provider used for delegated CLI roles.

### `packages/boot/app-boot/src/profile-resolution/resolver.ts:isInternalModuleUnavailable`
- `description`: Recognizes Node module-loading failures that identify the requested internal module as unavailable.
- `params.error`: Thrown value from the module-loading attempt.
- `params.moduleId`: Internal module identifier requested by the caller.
- `returns`: True only when a recognized Node error identifies the requested module itself as unavailable; false for unrelated or transitive failures.
### `packages/bundle/web-app/src/memorix.ts:BACKUP_SUFFIX`
- `description`: Suffix for the one-time database backup before Memorix 1.9.10 can update existing data.

### `packages/bundle/web-app/src/memorix.ts:backupExistingDatabase`
- `description`: Keeps one copy of an existing Memorix database and its SQLite sidecars.
- `params.dataDirectory`: Database directory, defaulting to MEMORIX_DATA_DIR or ~/.memorix/data.
- `returns`: The backup path, or undefined when no copy is needed.

### `packages/terminal/terminal-bash/src/session.ts:LocalPtySession.watchLine`
- `description`: Watches the sanitized output stream for an exact complete line.
- `params.line`: Complete output line to observe.
- `returns`: A handle to query the observation and remove the watch.

### `packages/terminal/terminal/src/index.ts:TerminalSessionService.watchLine`
- `description`: Watches an owned terminal for a complete output line when its backend supports it.
- `params.owner`: Agent that owns the terminal.
- `params.id`: Owned terminal identity.
- `params.line`: Complete output line to observe.
- `returns`: A watch handle, or undefined when the backend does not support watching.

### `packages/terminal/terminal-bash/src/sanitize.ts:TerminalSanitizer.resetPromptTracking`
- `description`: Discards a prompt-tail candidate observed before the active send's readiness boundary.
