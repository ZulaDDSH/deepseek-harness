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

### `packages/llm/llm-freebuff/src/adapter.ts:MODEL_ID`
- `description`: Model id of the single Freebuff route; Freebuff chooses the actual model itself.

### `packages/llm/llm-freebuff/src/adapter.ts:FreebuffReplay`
- `description`: Replay state carried on a Freebuff assistant message: the chat transcript id and the id of the last chat row already consumed.

### `packages/llm/llm-freebuff/src/adapter.ts:promptOf`
- `description`: Extracts the prompt of a turn: the text of the newest user-sourced message, rejecting slash and bang commands, images and files.
- `params.messages`: Request messages of the turn.
- `returns`: The prompt text to paste into the Freebuff terminal.

### `packages/llm/llm-freebuff/src/adapter.ts:resumeOf`
- `description`: Finds the Freebuff replay state on the newest assistant message that carries one.
- `params.messages`: Request messages of the turn.
- `returns`: The replay state, or undefined for a new conversation.

### `packages/llm/llm-freebuff/src/adapter.ts:FreebuffAdapter`
- `description`: Model adapter that runs each turn through a pooled Freebuff terminal and streams the rendered chat rows.

### `packages/llm/llm-freebuff/src/auth.ts:PROVIDER`
- `description`: Provider id of the Freebuff route and quota source.

### `packages/llm/llm-freebuff/src/auth.ts:FREEBUFF_KEY`
- `description`: Credential key under which the Freebuff sign-in marker is stored.

### `packages/llm/llm-freebuff/src/auth.ts:FreebuffAccount`
- `description`: Freebuff sign-in state: reads the doctor report, keeps the stored marker in step with it, and offers the sign-in authorization flow.

### `packages/llm/llm-freebuff/src/auth.ts:FreebuffAccount.status`
- `description`: Reports whether Freebuff is signed in, reusing a recent doctor result unless forced.
- `params.force`: Skip the cached doctor result.
- `returns`: The doctor status.

### `packages/llm/llm-freebuff/src/auth.ts:FreebuffAccount.reconcile`
- `description`: Runs the doctor check and writes or clears the stored sign-in marker to match it.
- `params.force`: Skip the cached doctor result.
- `returns`: The doctor status.

### `packages/llm/llm-freebuff/src/auth.ts:FreebuffAccount.signedOut`
- `description`: Clears the stored sign-in marker after a turn found Freebuff signed out.

### `packages/llm/llm-freebuff/src/auth.ts:FreebuffAccount.flow`
- `description`: Builds the authorization flow that runs `freebuff login` in a terminal and relays its first sign-in URL.
- `returns`: The authorization flow registered under the Freebuff credential key.

### `packages/llm/llm-freebuff/src/chat.ts:ChatBlock`
- `description`: One block of a Freebuff chat message as stored in the chat transcript file.

### `packages/llm/llm-freebuff/src/chat.ts:ChatMessage`
- `description`: One row of a Freebuff chat transcript file.

### `packages/llm/llm-freebuff/src/chat.ts:squash`
- `description`: Collapses every whitespace run to one space and trims the ends.
- `params.text`: Text to normalize.
- `returns`: The normalized text.

### `packages/llm/llm-freebuff/src/chat.ts:chatsDirOf`
- `description`: Locates the directory where Freebuff stores the chats of a working directory, keyed by its basename.
- `params.configDir`: Freebuff configuration directory.
- `params.cwd`: Working directory of the session.
- `returns`: The chats directory path.

### `packages/llm/llm-freebuff/src/chat.ts:listChats`
- `description`: Lists the chat ids stored in a chats directory.
- `params.chatsDir`: Directory returned by `chatsDirOf`.
- `returns`: The chat ids, or an empty list when the directory is missing.

### `packages/llm/llm-freebuff/src/chat.ts:readChat`
- `description`: Reads the messages of one chat transcript.
- `params.chatsDir`: Directory returned by `chatsDirOf`.
- `params.chatId`: Id of the chat.
- `returns`: The messages, or undefined when the transcript is missing or unreadable.

### `packages/llm/llm-freebuff/src/chat.ts:rowText`
- `description`: Extracts the visible text of a chat row.
- `params.message`: Chat row.
- `returns`: The row text, empty when the row has none.

### `packages/llm/llm-freebuff/src/chat.ts:bindChat`
- `description`: Finds the chat created for a submitted prompt by comparing the chat list with the list taken before submitting.
- `params.chatsDir`: Directory returned by `chatsDirOf`.
- `params.before`: Chat ids that existed before the prompt was submitted.
- `params.prompt`: Prompt text that was submitted.
- `returns`: The id of the chat whose first user row matches the prompt, or undefined when none does yet.

### `packages/llm/llm-freebuff/src/doctor.ts:DoctorStatus`
- `description`: Sign-in state from `freebuff doctor --json`: signed in, signed out, or unknown when the report cannot be read.

### `packages/llm/llm-freebuff/src/doctor.ts:DoctorRun`
- `description`: Inputs of one `freebuff doctor --json` run: the spawn function, executable, arguments, environment, working directory and time limits.

### `packages/llm/llm-freebuff/src/doctor.ts:doctorFindings`
- `description`: Reads the `auth.ok` finding from a doctor report.
- `params.stdout`: Standard output of `freebuff doctor --json`.
- `returns`: Signed in or signed out when the report names the finding, otherwise unknown.

### `packages/llm/llm-freebuff/src/doctor.ts:doctorStatus`
- `description`: Runs `freebuff doctor --json` with time and output limits and classifies the result.
- `params.run`: Doctor run inputs.
- `returns`: The doctor status; unknown when the run fails, times out or prints no report.

### `packages/llm/llm-freebuff/src/environment.ts:FreebuffTiming`
- `description`: Time limits and polling intervals of the Freebuff terminal driver, in milliseconds, plus the terminal cap.

### `packages/llm/llm-freebuff/src/environment.ts:DEFAULT_TIMING`
- `description`: Production values of `FreebuffTiming`.

### `packages/llm/llm-freebuff/src/environment.ts:FreebuffEnvironment`
- `description`: Everything the driver needs from the host: executable lookup, arguments, environment, configuration and home directories, platform, command interpreter and timing.

### `packages/llm/llm-freebuff/src/environment.ts:defaultEnvironment`
- `description`: Builds the production environment from the subprocess service and the process environment.
- `params.ctx`: Plugin context providing the subprocess service.
- `returns`: The Freebuff environment.

### `packages/llm/llm-freebuff/src/environment.ts:probeSignIn`
- `description`: Runs the doctor check inside the given environment.
- `params.ctx`: Plugin context providing the subprocess service.
- `params.environment`: Freebuff environment.
- `params.signal`: Aborts the check.
- `returns`: The doctor status.

### `packages/llm/llm-freebuff/src/install.ts:PLUGIN_NAME`
- `description`: Plugin name; also the settings namespace fallback of the Freebuff provider row.

### `packages/llm/llm-freebuff/src/install.ts:DEFAULT_IDLE_REAP_MS`
- `description`: Default idle time in milliseconds after which an unused Freebuff terminal is closed.

### `packages/llm/llm-freebuff/src/index.ts:Config`
- `description`: Deployment-owned idle timeout of pooled Freebuff terminals.

### `packages/llm/llm-freebuff/src/install.ts:FreebuffWiring`
- `description`: Host seams of the plugin: the Freebuff environment, the terminal spawner and, optionally, the quota reading options.

### `packages/llm/llm-freebuff/src/install.ts:installFreebuff`
- `description`: Registers the Freebuff sign-in flow, model route, settings row, terminal pool disposer and, when wired, the quota source.
- `params.ctx`: Plugin context.
- `params.config`: Plugin configuration.
- `params.wiring`: Host seams.
- `returns`: The terminal pool.

### `packages/llm/llm-freebuff/src/launch.ts:FreebuffLaunch`
- `description`: Argument vector and extra environment entries that start Freebuff.

### `packages/llm/llm-freebuff/src/launch.ts:freebuffLaunch`
- `description`: Builds the Freebuff command line, wrapping a Windows `.cmd` or `.bat` shim in the command interpreter and rejecting arguments that the interpreter would reinterpret.
- `params.executable`: Freebuff executable path or name.
- `params.args`: Arguments after the executable.
- `params.platform`: Platform the command runs on.
- `params.comSpec`: Command interpreter path on Windows.
- `returns`: The argument vector and the environment entries it needs.

### `packages/llm/llm-freebuff/src/launch.ts:freebuffConfigDir`
- `description`: Locates the Freebuff configuration directory.
- `params.env`: Process environment.
- `params.home`: User home directory.
- `returns`: The `.config/manicode` directory under the home directory.

### `packages/llm/llm-freebuff/src/launch.ts:stripAnsi`
- `description`: Removes terminal escape sequences from text.
- `params.text`: Text that may contain escape sequences.
- `returns`: The text without escape sequences.

### `packages/llm/llm-freebuff/src/markdown.ts:RenderedBlock`
- `description`: One text or reasoning block rendered from Freebuff chat rows.

### `packages/llm/llm-freebuff/src/markdown.ts:renderBlocks`
- `description`: Renders chat rows as text and reasoning blocks, fencing tool output and bounding its length.
- `params.messages`: Chat rows to render.
- `returns`: The rendered blocks in row order.

### `packages/llm/llm-freebuff/src/quota.ts:SESSION_URL`
- `description`: Freebuff usage endpoint that reports the hours left.

### `packages/llm/llm-freebuff/src/quota.ts:QUOTA_TTL_MS`
- `description`: Milliseconds a usage reading is reused before the endpoint is called again.

### `packages/llm/llm-freebuff/src/quota.ts:TokenReader`
- `description`: Reads the Freebuff token on demand; resolves undefined when Freebuff is not signed in.

### `packages/llm/llm-freebuff/src/quota.ts:FreebuffQuotaOptions`
- `description`: Token reader plus optional clock, time zone and not-configured message for the Freebuff quota source.

### `packages/llm/llm-freebuff/src/quota.ts:OpenHour`
- `description`: An open hour of the day: freebucks held and the instant it ends.

### `packages/llm/llm-freebuff/src/quota.ts:Usage`
- `description`: Daily and monthly freebucks parsed from the usage endpoint.

### `packages/llm/llm-freebuff/src/quota.ts:hours`
- `description`: Converts freebucks to whole hours at five freebucks per hour.
- `params.freebucks`: Freebucks; negative values count as zero.
- `returns`: The whole hours.

### `packages/llm/llm-freebuff/src/quota.ts:hoursMinutes`
- `description`: Formats freebucks as hours and minutes, rounding down to the minute.
- `params.freebucks`: Freebucks; negative values count as zero.
- `returns`: The time as `h:mm`.

### `packages/llm/llm-freebuff/src/quota.ts:decodeToken`
- `description`: Decodes a Credential Manager blob as UTF-8, or as UTF-16 when it contains NUL characters, and trims it; `quota.ts:decodeToken` returns the `authToken` field of a JSON blob.
- `params.blob`: Credential blob bytes.
- `returns`: The token, or undefined when `quota.ts:decodeToken` finds none.

### `packages/llm/llm-freebuff/src/quota.ts:credentialTarget`
- `description`: Builds the Credential Manager target under which Freebuff stores its token.
- `params.configDir`: Freebuff config directory for `quota.ts:credentialTarget` and `quota.ts:windowsTokenReader` (`FREEBUFF_CONFIG_DIR` or the default under the home directory).
- `returns`: The target name.

### `packages/llm/llm-freebuff/src/quota.ts:RunPowerShell`
- `description`: Runs a PowerShell script with extra environment entries and resolves its standard output.

### `packages/llm/llm-freebuff/src/quota.ts:ExecFile`
- `description`: The part of `execFile` that the PowerShell runner uses, so a test can stand in for the process.

### `packages/llm/llm-freebuff/src/quota.ts:runPowerShell`
- `description`: Runs an encoded PowerShell script with extra environment entries and resolves its standard output; any failure rejects with a fixed message that carries neither output nor error text.
- `params.script`: PowerShell source.
- `params.env`: Environment entries added to the process environment.
- `params.exec`: Process runner, `execFile` by default.
- `returns`: The standard output.

### `packages/llm/llm-freebuff/src/quota.ts:windowsTokenReader`
- `description`: Builds a token reader that reads the Freebuff credential through PowerShell without putting the token on a command line.
- `params.configDir`: Freebuff config directory for `quota.ts:credentialTarget` and `quota.ts:windowsTokenReader` (`FREEBUFF_CONFIG_DIR` or the default under the home directory).
- `params.run`: PowerShell runner.
- `returns`: The token reader.

### `packages/llm/llm-freebuff/src/quota.ts:defaultQuotaOptions`
- `description`: Chooses the production quota options: the Windows reader, or a reader that reports not configured on other platforms.
- `params.platform`: Platform name.
- `returns`: The quota options.

### `packages/llm/llm-freebuff/src/quota.ts:parseUsage`
- `description`: Validates the usage endpoint response and extracts its daily and monthly freebucks.
- `params.body`: Parsed JSON body.
- `returns`: The usage, or undefined when the daily figures are missing.

### `packages/llm/llm-freebuff/src/quota.ts:quotaWindows`
- `description`: Builds the `daily` and `monthly` quota windows, counting the unused part of each open hour as still left.
- `params.usage`: Parsed usage.
- `params.now`: Current time in milliseconds.
- `returns`: The windows keyed by window id.

### `packages/llm/llm-freebuff/src/quota.ts:createFreebuffQuotaSource`
- `description`: Builds the quota source that reads the hours left with the stored Freebuff token and never exposes it.
- `params.options`: Token reader and clock seams.
- `returns`: The quota source with id `freebuff`.

### `packages/llm/llm-freebuff/src/screen.ts:ScreenState`
- `description`: Classification of the Freebuff terminal screen: login prompt, trust prompt, blocker text, busy and ready.

### `packages/llm/llm-freebuff/src/screen.ts:classifyScreen`
- `description`: Classifies the rendered terminal text.
- `params.text`: Rendered screen text.
- `params.task`: Prompt being worked on, used to tell the echoed prompt from a blocker.
- `returns`: The screen state.

### `packages/llm/llm-freebuff/src/screen.ts:FreebuffScreen`
- `description`: Headless terminal that renders the Freebuff screen from its output stream.

### `packages/llm/llm-freebuff/src/screen.ts:FreebuffScreen.write`
- `description`: Feeds terminal output to the renderer.
- `params.data`: Output bytes as text.

### `packages/llm/llm-freebuff/src/screen.ts:FreebuffScreen.text`
- `description`: Reads the rendered screen.
- `returns`: The visible rows joined by newlines.

### `packages/llm/llm-freebuff/src/screen.ts:FreebuffScreen.dispose`
- `description`: Releases the renderer.

### `packages/llm/llm-freebuff/src/session.ts:TurnRequest`
- `description`: One turn: the prompt, working directory, resumed chat and consumed marker, and the abort signal.

### `packages/llm/llm-freebuff/src/session.ts:TurnEnd`
- `description`: Chat id and consumed marker at the end of a turn, returned in the replay state.

### `packages/llm/llm-freebuff/src/session.ts:PoolOptions`
- `description`: Environment, account, terminal spawner and idle reap time of the terminal pool.

### `packages/llm/llm-freebuff/src/session.ts:FreebuffSession`
- `description`: One Freebuff terminal and chat bound to a harness session.

### `packages/llm/llm-freebuff/src/session.ts:FreebuffSession.chatId`
- `description`: Id of the Freebuff chat this session writes to, once known.

### `packages/llm/llm-freebuff/src/session.ts:FreebuffSession.consumed`
- `description`: Id of the last chat row already returned to the harness.

### `packages/llm/llm-freebuff/src/session.ts:FreebuffSession.lastUsed`
- `description`: Time in milliseconds of the last use, for idle reaping and eviction.

### `packages/llm/llm-freebuff/src/session.ts:FreebuffSession.running`
- `description`: Whether a turn is running.

### `packages/llm/llm-freebuff/src/session.ts:FreebuffSession.occupied`
- `description`: Whether the session holds or is starting a terminal.

### `packages/llm/llm-freebuff/src/session.ts:FreebuffSession.turn`
- `description`: Runs one turn: submits the prompt and yields rendered blocks as chat rows appear.
- `params.request`: The turn to run.
- `returns`: An async generator of rendered blocks that returns the chat id and consumed marker.

### `packages/llm/llm-freebuff/src/session.ts:FreebuffSession.kill`
- `description`: Terminates the terminal of this session.

### `packages/llm/llm-freebuff/src/session.ts:FreebuffPool`
- `description`: Bounded set of Freebuff sessions keyed by harness session id.

### `packages/llm/llm-freebuff/src/session.ts:FreebuffPool.session`
- `description`: Finds or creates the session of a harness session id.
- `params.id`: Harness session id.
- `returns`: The Freebuff session.

### `packages/llm/llm-freebuff/src/session.ts:FreebuffPool.makeRoom`
- `description`: Closes the least recently used idle terminal when the terminal cap is reached.
- `params.requester`: Session that needs a terminal and is never evicted.
- `returns`: A promise that settles once a slot is free.

### `packages/llm/llm-freebuff/src/session.ts:FreebuffPool.dispose`
- `description`: Terminates every terminal and stops idle reaping.
