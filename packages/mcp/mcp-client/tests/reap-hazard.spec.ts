/**
 * Disposal must never signal a numeric pid it cached before closing a stdio
 * transport. A child that exits while a detached descendant keeps its stdio
 * pipes open leaves the transport's `close` event pending forever, so the
 * supervisor's post-close wait expires on a child that already exited; the
 * number is then a free slot the OS may hand to an unrelated process, and a
 * delayed `process.kill(pid, 'SIGKILL')` would kill that stranger instead.
 *
 * These cases drive a real `StdioClientTransport`, so the observable is the
 * child process itself rather than a mocked generation.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config } from '@deepseek-ai/dsh-mcp-client'
import { startConnection, resolveReconnectPolicy } from '@deepseek-ai/dsh-mcp-client/src/connection.ts'

const FIXTURE_SERVER = fileURLToPath(new URL('./reap-fixture-server.ts', import.meta.url))

/** Reap a descendant a fixture left holding the transport pipes. */
function reapMarker(markerPath: string): void {
  let raw: string
  try {
    raw = readFileSync(markerPath, 'utf8').trim()
  } catch {
    return
  }
  const pid = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(pid) || pid <= 0) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return
  }
}

function configFor(args: readonly string[]): Config {
  return {
    transport: 'stdio',
    serverName: 'srv',
    command: process.execPath,
    args: [...args],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 2_000,
    failOnStartupError: false,
  }
}

function captureErrors(ctx: Context): string[] {
  const errors: string[] = []
  ctx.logger.error = ((message: unknown) => { errors.push(String(message)) }) as typeof ctx.logger.error
  ctx.logger.warn = (() => {}) as typeof ctx.logger.warn
  ctx.logger.info = (() => {}) as typeof ctx.logger.info
  return errors
}

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** Whether the process behind `pid` is alive right now. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
}

/**
 * Run one supervised connection against a real MCP server that exits with its
 * stdio inherited by a descendant, and return the supervisor handle. The
 * caller owns disposal; {@link reapMarker} clears the descendant afterwards.
 */
async function connectExitingChild(
  ctx: Context,
  root: string,
  failOnStartupError = false,
): Promise<ReturnType<typeof startConnection>> {
  const marker = join(root, 'grandchild.pid')
  const config = {
    ...configFor(['--import', 'tsx', FIXTURE_SERVER, marker]),
    failOnStartupError,
  }
  const handle = startConnection(ctx, config, resolveReconnectPolicy({ enabled: false }, 'reap-hazard'))
  await handle.ready
  // `ready` settles when the first connect+sync finishes, which can precede the
  // server's own exit. Wait for the descendant marker so disposal observes the
  // exit-with-inherited-pipes state this file is about.
  await vi.waitFor(() => { expect(markerExists(marker)).toBe(true) }, { timeout: 30_000, interval: 50 })
  await handle.dispose()
  return handle
}

/** Whether the child published its descendant pid yet. */
function markerExists(path: string): boolean {
  try {
    return readFileSync(path, 'utf8').trim().length > 0
  } catch {
    return false
  }
}

describe('stdio disposal never signals a cached pid', () => {
  let root = ''
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dsh-reap-hazard-')) })
  afterEach(() => {
    reapMarker(join(root, 'grandchild.pid'))
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('sends no SIGKILL while disposing a transport whose child already exited', async () => {
    const ctx = await mountRegistry()
    const killSpy = vi.spyOn(process, 'kill')
    try {
      const handle = await connectExitingChild(ctx, root)
      const sigkills = killSpy.mock.calls.filter(([, signal]) => signal === 'SIGKILL')
      expect(sigkills, 'disposal must not SIGKILL a cached numeric pid').toEqual([])
      await handle.dispose()
    } finally {
      killSpy.mockRestore()
      await ctx.fiber.dispose()
    }
  }, 90_000)

  it('leaves an unrelated live process untouched when the transport child exited', async () => {
    const ctx = await mountRegistry()
    const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const bystanderPid = bystander.pid
    if (bystanderPid === undefined) throw new Error('expected the bystander fixture to report a pid')
    try {
      const handle = await connectExitingChild(ctx, root)
      expect(isAlive(bystanderPid), 'an unrelated live process must survive disposal').toBe(true)
      expect(bystander.exitCode).toBeNull()
      expect(bystander.signalCode).toBeNull()
      await handle.dispose()
    } finally {
      if (bystander.exitCode === null && bystander.signalCode === null) bystander.kill('SIGKILL')
      await waitForExit(bystander)
      await ctx.fiber.dispose()
    }
  }, 90_000)

  it('reports unconfirmed closure instead of signalling the exited child', async () => {
    const ctx = await mountRegistry()
    const errors = captureErrors(ctx)
    try {
      const handle = await connectExitingChild(ctx, root)
      expect(errors.some(line => line.includes('transport closure could not be confirmed'))).toBe(true)
      expect(handle.instructions()).toBe('')
      await handle.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  }, 90_000)
})
