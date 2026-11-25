# Master Control

This optional plugin adds a dedicated Master Control chat. Toggle **Workspace sessions** to see ordinary workspace chats and change each session’s next model and effort. Toggle **Repair station** to view PR Fixer repair chats separately and jump directly into a repair chat in PR Fixer. Toggle **Review queue** to see Auto Auditor submissions and open their findings. Select **Chat** or press the active panel button again to return to the full-width chat. The plugin also applies the bundled light and dark appearance styles to the desktop interface.

Master Control uses the profile’s Standard and Creator tools with Full access. It can list sessions, send messages, read recent replies, and start a fresh session from a UTF-8 state file up to 16 KiB. The new session retains the lead’s working directory, workspace, mode, named permission preset, and model selection. It summarizes the handoff in its first turn and waits for a new assignment. The original session and its jobs remain available.

Run `npm pack` in this directory and add the resulting tarball to a desktop profile with `dsh plugin --profile desktop add <tarball>`. This contribution targets the Harness `0.2.2-rc.5` desktop runtime.
