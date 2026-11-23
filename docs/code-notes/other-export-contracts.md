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

### `packages/subagent/subagent-freebuff/src/errors.ts:FREEBUFF_LOGIN_COMMAND`
- `description`: Command the user runs in a terminal to sign in to Freebuff.

### `packages/subagent/subagent-freebuff/src/errors.ts:FreebuffNotInstalledError`
- `description`: Failure raised when the configured Freebuff executable cannot be found.

### `packages/subagent/subagent-freebuff/src/errors.ts:FreebuffNotLoggedInError`
- `description`: Failure raised when Freebuff shows a login screen or its doctor report says it is signed out; carries the detection reason.

### `packages/subagent/subagent-freebuff/src/errors.ts:FreebuffFailureStage`
- `description`: Run stage in which a Freebuff failure happened.

### `packages/subagent/subagent-freebuff/src/errors.ts:FreebuffFailureCategory`
- `description`: Classification of a Freebuff run failure.

### `packages/subagent/subagent-freebuff/src/errors.ts:FreebuffRunFailure`
- `description`: Product failure of a Freebuff run, carrying stage, category, optional detail and the last screen rows.

### `packages/subagent/subagent-freebuff/src/index.ts:Config`
- `description`: Deployment-owned executable, working directory, environment, login-check and timing settings of the Freebuff provider.

### `packages/subagent/subagent-freebuff/src/login.ts:LoginCheck`
- `description`: Inputs of the pre-run `freebuff doctor --json` sign-in check.

### `packages/subagent/subagent-freebuff/src/login.ts:DoctorCommand`
- `description`: Argument vector and extra environment used to run `freebuff doctor --json`.

### `packages/subagent/subagent-freebuff/src/login.ts:doctorCommand`
- `description`: Builds the doctor command line, wrapping a Windows `.cmd` or `.bat` shim in the command interpreter and passing its quoted path through an environment variable so a path with spaces survives.
- `params.executable`: Freebuff executable path or name.
- `params.platform`: Platform the command will run on.
- `params.comSpec`: Command interpreter path on Windows; cmd.exe when undefined.
- `returns`: The argument vector and the environment entries it needs.

### `packages/subagent/subagent-freebuff/src/login.ts:freebuffLoginFailure`
- `description`: Extracts the signed-out finding id from a `freebuff doctor --json` report.
- `params.stdout`: Raw doctor standard output, possibly with text before the JSON.
- `returns`: The signed-out finding id, or undefined when signed in or the report is unreadable.

### `packages/subagent/subagent-freebuff/src/login.ts:checkFreebuffLogin`
- `description`: Runs `freebuff doctor --json` with a timeout and reports whether Freebuff is signed out; a doctor that cannot run never blocks the run.
- `params.check`: Spawn function, executable, working directory, environment, limits and platform of the check.
- `returns`: The signed-out finding id, or undefined when signed in or undeterminable.

### `packages/subagent/subagent-freebuff/src/run.ts:DEFAULT_DISPOSE_GRACE_MS`
- `description`: Default grace in milliseconds between terminal termination tiers.

### `packages/subagent/subagent-freebuff/src/run.ts:DEFAULT_STARTUP_TIMEOUT_MS`
- `description`: Default milliseconds to wait for the ready screen and for the task to start.

### `packages/subagent/subagent-freebuff/src/run.ts:DEFAULT_IDLE_MS`
- `description`: Default milliseconds without a busy marker before a turn counts as finished.

### `packages/subagent/subagent-freebuff/src/run.ts:DEFAULT_TIMEOUT_MS`
- `description`: Default wall-clock limit in milliseconds for one published run.

### `packages/subagent/subagent-freebuff/src/run.ts:FreebuffRunSpec`
- `description`: Resolved executable, environment, timing and terminal-spawn settings of one Freebuff run.

### `packages/subagent/subagent-freebuff/src/run.ts:taskText`
- `description`: Flattens the text blocks of a one-shot prompt into the task pasted into Freebuff, removing control characters and rejecting tasks Freebuff would run as a command.
- `params.prompt`: Prompt content blocks; only text blocks are accepted.
- `returns`: The trimmed task text.

### `packages/subagent/subagent-freebuff/src/run.ts:startFreebuffRun`
- `description`: Starts Freebuff in a pseudo-terminal, waits for the ready screen, pastes the task and returns a published run that settles with the answer or a diagnosed failure.
- `params.request`: Subagent start request with the prompt and the startup abort signal.
- `params.spec`: Resolved run settings.
- `returns`: The published subagent run.

### `packages/subagent/subagent-freebuff/src/screen.ts:CLIPPED_NOTICE`
- `description`: Notice prefixed to a screen-derived answer whose task echo is not visible, meaning the answer may be incomplete.

### `packages/subagent/subagent-freebuff/src/screen.ts:ScreenState`
- `description`: Classification of one rendered Freebuff screen: login, trust prompt, blocker, busy and ready.

### `packages/subagent/subagent-freebuff/src/screen.ts:ScreenAnswer`
- `description`: Answer text read from the screen and whether it may be clipped because the task echo was not found.

### `packages/subagent/subagent-freebuff/src/screen.ts:classifyScreen`
- `description`: Classifies a rendered screen; with a task, markers are searched only in the last rows and ignored when they are part of the task.
- `params.text`: Rendered screen text.
- `params.task`: Task pasted into Freebuff, used to ignore markers echoed from it.
- `returns`: The classification of the screen.

### `packages/subagent/subagent-freebuff/src/screen.ts:screenAnswer`
- `description`: Extracts the reply that follows the task echo from the screen, dropping footer, status line, trailing boxes and chrome rows.
- `params.text`: Rendered screen text.
- `params.task`: Task whose first line anchors the start of the reply.
- `returns`: The reply text and whether it may be clipped.

### `packages/subagent/subagent-freebuff/src/screen.ts:FreebuffScreen`
- `description`: Headless terminal emulator that renders Freebuff output into screen text and answers terminal queries.

### `packages/subagent/subagent-freebuff/src/screen.ts:FreebuffScreen.write`
- `description`: Feeds terminal output into the emulator.
- `params.data`: Raw terminal output.

### `packages/subagent/subagent-freebuff/src/screen.ts:FreebuffScreen.text`
- `description`: Renders the current screen as text with trailing blank rows removed.
- `returns`: The screen text, one line per row.

### `packages/subagent/subagent-freebuff/src/screen.ts:FreebuffScreen.dispose`
- `description`: Releases the emulator and its reply subscription.

### `packages/subagent/subagent-freebuff/src/transcript.ts:FreebuffTranscript`
- `description`: Completion state, answer and error of the last turn in a Freebuff chat transcript.

### `packages/subagent/subagent-freebuff/src/transcript.ts:freebuffConfigDir`
- `description`: Resolves the Freebuff config directory that holds chat transcripts.
- `params.env`: Environment that may name an absolute config directory.
- `params.home`: Home directory used when none is configured.
- `returns`: The config directory path.

### `packages/subagent/subagent-freebuff/src/transcript.ts:findChatFile`
- `description`: Finds the transcript file of this run: the newest chat modified since the run started whose last user message equals the task.
- `params.configDir`: Freebuff config directory.
- `params.cwd`: Working directory whose basename keys the chat folder.
- `params.since`: Earliest modification time in milliseconds.
- `params.task`: Task pasted into Freebuff.
- `returns`: The transcript path, or undefined when no chat matches.

### `packages/subagent/subagent-freebuff/src/transcript.ts:readTranscript`
- `description`: Reads the last turn of a chat transcript; an error followed by a complete answer counts as recovered.
- `params.file`: Transcript file path.
- `returns`: The turn state, or undefined when the file is unreadable or has no user message.

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
