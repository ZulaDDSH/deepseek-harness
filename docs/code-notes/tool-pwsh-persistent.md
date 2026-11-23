# tool-pwsh-persistent code notes

## A terminating error always fails the call (finding 131)

- `packages/shell/tool-pwsh-persistent/src/index.ts:wrapCommand` - the wrapper let any non-null `$LASTEXITCODE` win over the caught-error flag, so `native-success; throw 'x'` reported `0` (the catch set `$__ok` false but `$LASTEXITCODE` stayed 0) and printed nothing about the exception. The status line now checks `$__ok` first: a terminating exception reports `1` regardless of the last native exit code, and the catch writes the formatted error record to the output so the model sees why. Without a terminating error the previous rule is unchanged: the last native exit code when one ran in this call (`$LASTEXITCODE` is reset to `$null` before the command, so a code from an earlier call never leaks), otherwise `0`.
- Not changed: `$?` after `Invoke-Expression` stays true for non-terminating statement errors, so `native-success; Get-Item missing` still reports `0` (non-terminating PowerShell errors are visible in the output only), and `native-failure; Get-Date` reports the native code because the wrapper cannot see per-statement status inside the evaluated block. The README states both.

## stdin_read fallback keeps the session open (finding 130)

- `packages/shell/tool-pwsh-persistent/src/index.ts` (the `stdin_read` fallback in the command wait loop) - kept as is for the same reason as the bash twin, see `docs/code-notes/tool-bash-persistent.md`. Its test asserts that the fallback does not reset the shell, so the limit is documented in the README instead of changed.
