---
name: gsd-debug
description: Investigate one bug systematically with a persistent file in .planning/debug, reproduce it first, test ranked hypotheses, and fix the confirmed root cause through a coder. Use when the user runs /gsd-debug or reports a bug to track down.
---

# /gsd-debug

Find the root cause of one bug and record every step, so a later session can continue after a context reset. Investigation does not change product code. Only the confirmed fix does, through a coder.

Settings: follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings). Defaults are in `shared/settings.md`. File and tool conventions are in `shared/conventions.md`.

Subcommands: `list` shows the files in `.planning/debug/` with their status. `status <slug>` prints one file. `continue <slug>` resumes one. Anything else starts a new session.

## Steps

1. For `list`, `status` or `continue`, read the matching file under `.planning/debug/`. Report it, or resume it at its last open hypothesis.
2. For a new session, ask the symptoms in one `ask_user_question` call: expected behaviour, actual behaviour, the exact error text or log, and how to reproduce it. Skip any the user already gave.
3. Create `.planning/debug/<slug>.md` with the symptoms, `status: investigating`, and a hypothesis table with the columns id, hypothesis, evidence for, evidence against and status.
4. Reproduce first. Run the failing command or test with `bash`, and record the exact command and its output. If you cannot reproduce it, say so and ask for the missing input.
5. Form two to four hypotheses, most likely first. For each, find the code that would produce the symptom with `grep` and `read`.
   - Test one hypothesis at a time with runs of existing commands and reads of the code.
   - Do not add logging or edit product code during investigation.
   - Record the evidence in the file after each test.
6. State the root cause with its `file:line`. Confirm it: the reproduction should change, in the way the cause predicts, when the cause is removed or altered in a scratch copy under `bash`. Do not patch the symptom.
7. Ask with `ask_user_question`: "The root cause is <cause>. Fix it?" Options: "Fix with a coder and add a regression test (Recommended)", "Show the fix plan only" and "Stop".
   - For the fix, run one `coder` child with the cause, the reproduction and the test to add.
   - It commits as `fix(debug-<slug>): <summary>` and reruns the reproduction.
8. Set the file to `status: resolved`, record the commit, and report.

## Rules

- If three hypotheses in a row are ruled out, stop, record that, and ask the user for more information rather than guessing.

Adapted from GSD (MIT), see NOTICE-GSD.md
