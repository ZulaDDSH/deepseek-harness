/**
 * Real-pwsh checks of the script file each execution runs from: non-ASCII output
 * round-trips, exit statuses survive `-File`, and the file is removed however the
 * execution settles.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PwshLocalExecutor, resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { ShellExecRequest } from '@deepseek-ai/dsh-shell'

const hasPwsh = spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0

/** Normalize PowerShell's platform line endings (CRLF on Windows, LF elsewhere). */
const lf = (text: string): string => text.replace(/\r\n/g, '\n')

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-pwsh-script-file-'))
afterAll(() => {
  rmSync(spillDir, { recursive: true, force: true })
})

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** An executor over real pwsh whose spawns are recorded, so a test can name the script file it ran. */
async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  const spawn = vi.spyOn(ctx.subprocess, 'spawn')
  await ctx.plugin(PwshLocalExecutor, { graceMs: 200 })
  const shell = ctx.shell as PwshLocalExecutor
  return { shell, lastScript: (): string => spawn.mock.calls.at(-1)![0].argv.at(-1)! }
}

async function run(shell: PwshLocalExecutor, request: ShellExecRequest) {
  return (await shell.execute(shell.resolve(request))).result()
}

describe.skipIf(!hasPwsh || process.platform !== 'win32')('PwshLocalExecutor script file (win32, real pwsh)', () => {
  it('round-trips non-ASCII output and removes the script file after a normal exit', { timeout: 15_000 }, async () => {
    const { shell, lastScript } = await setup()
    const result = await run(shell, { command: 'Write-Output 你好' })
    expect(result.exitCode).toBe(0)
    expect(lf(result.stdout.text)).toBe('你好\n')
    expect(existsSync(lastScript())).toBe(false)
  })

  it('keeps the status of exit N, of a failing last command, and of a native exit', { timeout: 15_000 }, async () => {
    const { shell } = await setup()
    const exited = await run(shell, { command: 'Write-Output $PSCommandPath; exit 3' })
    expect(exited.exitCode).toBe(3)
    expect(existsSync(lf(exited.stdout.text).trim())).toBe(false)
    expect((await run(shell, { command: 'Write-Error boom' })).exitCode).toBe(1)
    expect((await run(shell, { command: `& '${process.execPath}' -e 'process.exit(4)'` })).exitCode).toBe(4)
  })

  it('removes the script file when the command times out', { timeout: 15_000 }, async () => {
    const { shell, lastScript } = await setup()
    const result = await run(shell, { command: 'Start-Sleep -Seconds 60', timeoutMs: 200 })
    expect(result.timedOut).toBe(true)
    expect(existsSync(lastScript())).toBe(false)
  })

  it('keeps the script file while the command runs and removes it once the command is killed', { timeout: 15_000 }, async () => {
    const { shell, lastScript } = await setup()
    const ex = await shell.execute(shell.resolve({ command: 'Start-Sleep -Seconds 60' }))
    expect(existsSync(lastScript())).toBe(true)
    ex.kill()
    await ex.result()
    expect(existsSync(lastScript())).toBe(false)
  })
})
