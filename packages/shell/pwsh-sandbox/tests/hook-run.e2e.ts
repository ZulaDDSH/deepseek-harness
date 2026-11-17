import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { runHook } from '@deepseek-ai/dsh-hook-protocol'
import type { RunHookResult } from '@deepseek-ai/dsh-hook-protocol'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { SandboxPwshExecutor } from '../src/index.ts'

const PARENT_SCRIPT = `import { spawn } from 'node:child_process'
const kind = process.argv[2]
if (kind === 'tree') {
  spawn(process.execPath, ['-e', "require('fs').writeFileSync(process.env.HEARTBEAT, String(Date.now())); setInterval(() => require('fs').writeFileSync(process.env.HEARTBEAT, String(Date.now())), 100)"], { stdio: 'pipe', env: { ...process.env, HEARTBEAT: process.argv[3] } })
  setInterval(() => {}, 1000)
} else {
  const [program, args] = kind === 'pipe-cmd' ? ['cmd.exe', ['/c', 'exit 0']] : [process.execPath, ['-e', '0']]
  try {
    const child = spawn(program, args, { stdio: kind === 'inherit' ? 'inherit' : 'pipe' })
    child.on('error', error => { console.error('CHILD-ERROR ' + error.code); process.exitCode = 1 })
    child.on('exit', code => { console.log('CHILD-EXIT ' + code); process.exitCode = code ?? 1 })
  } catch (error) {
    console.error('SPAWN-THREW ' + error.code)
    process.exitCode = 1
  }
}
`

const isWin32 = process.platform === 'win32'

function pwshAvailable(): boolean {
  return spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0
}

describe.skipIf(!isWin32 || !pwshAvailable())('hook run through the pwsh executor', () => {
  let root!: string
  let workspace!: string
  let parent!: string
  let executor!: SandboxPwshExecutor

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-hook-run-e2e-'))
    workspace = join(root, 'workspace')
    mkdirSync(workspace)
    parent = join(root, 'parent.mjs').replace(/\\/g, '/')
    writeFileSync(parent, PARENT_SCRIPT)

    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(LocalSandboxProvider, {})
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(SandboxPwshExecutor, {})
    executor = ctx.shell as SandboxPwshExecutor
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function runChild(kind: 'pipe-node' | 'pipe-cmd' | 'inherit', sandboxPolicy?: SandboxExecutionPolicy): Promise<RunHookResult> {
    return runHook(executor, { command: `node ${parent} ${kind}` }, {
      payload: { probe: kind },
      cwd: workspace,
      signal: new AbortController().signal,
      trailingNewline: true,
      defaultTimeoutMs: 60_000,
      ...sandboxPolicy === undefined ? {} : { sandboxPolicy },
    }, () => Date.now())
  }

  it('deployment default confinement: a piped child spawn fails with EPERM', async () => {
    const { output } = await runChild('pipe-node')
    expect(output.exitCode).toBe(1)
    expect(output.stderr).toContain('EPERM')
  }, 120_000)

  it('inherited stdio children spawn under the deployment confinement', async () => {
    const { output } = await runChild('inherit')
    expect(output.exitCode, output.stderr).toBe(0)
  }, 120_000)

  it.each(['pipe-node', 'pipe-cmd'] as const)('a session danger-full-access policy runs the hook unconfined: %s child spawns', async (kind) => {
    const { output } = await runChild(kind, { mode: 'danger-full-access', workspaceRoot: workspace })
    expect(output.exitCode, output.stderr).toBe(0)
    expect(output.stdout).toContain('CHILD-EXIT 0')
  }, 120_000)

  it('aborting a danger-full-access hook ends the child tree it spawned', async () => {
    const heartbeat = join(root, 'heartbeat.txt')
    const controller = new AbortController()
    const pending = runHook(executor, { command: `node ${parent} tree ${heartbeat.replace(/\\/g, '/')}` }, {
      payload: {},
      cwd: workspace,
      signal: controller.signal,
      trailingNewline: true,
      defaultTimeoutMs: 60_000,
      sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: workspace },
    }, () => Date.now())
    for (let waited = 0; !existsSync(heartbeat); waited += 100) {
      if (waited > 60_000) throw new Error('the grandchild never wrote its heartbeat')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(Date.now() - statSync(heartbeat).mtimeMs).toBeLessThan(1000)
    controller.abort()
    await pending
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(Date.now() - statSync(heartbeat).mtimeMs).toBeGreaterThan(1000)
  }, 120_000)
})
