/**
 * Disposal for the mcp-client connection supervisor: when the transport-owned
 * close signal never arrives, disposal reports the unconfirmed closure and
 * still settles so shutdown can complete. Signalling the child belongs to the
 * transport that spawned it; a pid cached before close can name an unrelated
 * process once the child has exited, so the supervisor never signals one.
 * Isolated file so the MCP SDK mocks cannot pollute other test suites.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

const { mockConnect, mockClose, mockListTools, mockCreateTransport, MockClient, instances } = vi.hoisted(() => {
  const mockConnect = vi.fn<() => Promise<void>>()
  const mockClose = vi.fn<() => Promise<void>>()
  const mockListTools = vi.fn<() => Promise<unknown>>()
  const mockCreateTransport = vi.fn<() => unknown>()
  class MockClient {
    transport: object | undefined = {}
    onclose: (() => void) | undefined
    connect = mockConnect
    close = mockClose
    getServerCapabilities = () => ({ tools: {} })
    getInstructions(): string | undefined { return undefined }
    listResources = async () => ({ resources: [] })
    listTools = mockListTools
    constructor() {
      instances.push(this)
    }
  }
  const instances: MockClient[] = []
  return { mockConnect, mockClose, mockListTools, mockCreateTransport, MockClient, instances }
})

vi.mock('@modelcontextprotocol/client', async importOriginal => ({
  ...await importOriginal<typeof import('@modelcontextprotocol/client')>(),
  Client: MockClient,
}))

vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: vi.fn(function () { return { close: () => Promise.resolve() } }),
}))

vi.mock('../src/transport.ts', () => ({ createTransport: mockCreateTransport }))

import { startConnection, resolveReconnectPolicy } from '@deepseek-ai/dsh-mcp-client/src/connection.ts'

const testToolSignal = new AbortController().signal

let callSeq = 0
function nextCallId(): ToolCallId {
  return ToolCallId(`disposal-${++callSeq}`)
}

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function stdioConfig(): Config {
  return {
    transport: 'stdio',
    serverName: 'srv',
    command: 'echo',
    args: [],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
  }
}

function captureErrors(ctx: Context): string[] {
  const errors: string[] = []
  ctx.logger.error = ((message: unknown) => { errors.push(String(message)) }) as typeof ctx.logger.error
  return errors
}

function sleep(ms: number): Promise<void> {
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  setTimeout(gate.resolve, ms)
  return gate.promise
}

/** A child that stays alive until killed, holding no pipes back to this process. */
function liveChild(): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  child.unref()
  return child
}

describe('connection disposal escalation', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    instances.length = 0
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.resolve()
    })
    mockListTools.mockResolvedValue({ tools: [], nextCursor: undefined })
    mockCreateTransport.mockReturnValue({ pid: null, close: async () => {} })
  })

  it('releases the generation and rejects later resource requests after dispose', async () => {
    const ctx = await mountRegistry()
    await ctx.plugin(McpResources)
    const handle = startConnection(ctx, stdioConfig(), resolveReconnectPolicy({ enabled: false }, 'disposal'))
    try {
      await expect(handle.ready).resolves.toEqual({})
      ctx.mcpResources.register('srv', handle.resources)
      const listed = await ctx.tools.execute({
        name: 'list_mcp_resources', arguments: { server: 'srv' },
        callId: nextCallId(), signal: testToolSignal,
      })
      expect(listed.isError).toBe(false)
      await handle.dispose()
      const rejected = await ctx.tools.execute({
        name: 'list_mcp_resources', arguments: { server: 'srv' },
        callId: nextCallId(), signal: testToolSignal,
      })
      expect(rejected.isError).toBe(true)
      expect(JSON.stringify(rejected.content)).toContain('server is disconnected')
      expect(handle.instructions()).toBe('')
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('reports unconfirmed closure without signalling the child by pid', async () => {
    const ctx = await mountRegistry()
    const errors = captureErrors(ctx)
    const child = liveChild()
    if (child.pid === undefined) throw new Error('expected the fixture child to report a pid')
    const killSpy = vi.spyOn(process, 'kill')
    try {
      mockClose.mockImplementation(() => Promise.resolve())
      mockCreateTransport.mockReturnValue({ pid: child.pid, close: async () => {} })
      const handle = startConnection(ctx, stdioConfig(), resolveReconnectPolicy({ enabled: false }, 'disposal'))
      try {
        await expect(handle.ready).resolves.toEqual({})
        await handle.dispose()
        expect(killSpy.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toEqual([])
        expect(errors.some(line => line.includes('transport closure could not be confirmed'))).toBe(true)
        expect(handle.instructions()).toBe('')
      } finally {
        await handle.dispose()
      }
    } finally {
      killSpy.mockRestore()
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await sleep(200)
      }
      await ctx.fiber.dispose()
    }
  }, 60_000)

  it('settles disposal without a child pid when closure is never reported', async () => {
    const ctx = await mountRegistry()
    const errors = captureErrors(ctx)
    mockClose.mockImplementation(() => Promise.resolve())
    mockCreateTransport.mockReturnValue({ close: async () => {} })
    const handle = startConnection(ctx, stdioConfig(), resolveReconnectPolicy({ enabled: false }, 'disposal'))
    try {
      await expect(handle.ready).resolves.toEqual({})
      await handle.dispose()
      expect(errors.some(line => line.includes('transport closure could not be confirmed'))).toBe(true)
      expect(handle.instructions()).toBe('')
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  }, 60_000)

  it('never signals a transport-supplied pid when closure is never reported', async () => {
    const ctx = await mountRegistry()
    const errors = captureErrors(ctx)
    const killSpy = vi.spyOn(process, 'kill')
    const bystander = liveChild()
    if (bystander.pid === undefined) throw new Error('expected the fixture child to report a pid')
    try {
      mockClose.mockImplementation(() => Promise.resolve())
      mockCreateTransport.mockReturnValue({ pid: bystander.pid, close: async () => {} })
      const handle = startConnection(ctx, stdioConfig(), resolveReconnectPolicy({ enabled: false }, 'disposal'))
      try {
        await expect(handle.ready).resolves.toEqual({})
        await handle.dispose()
        expect(killSpy.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toEqual([])
        expect(bystander.exitCode).toBeNull()
        expect(bystander.signalCode).toBeNull()
        expect(errors.some(line => line.includes('transport closure could not be confirmed'))).toBe(true)
        expect(handle.instructions()).toBe('')
      } finally {
        await handle.dispose()
      }
    } finally {
      killSpy.mockRestore()
      if (bystander.exitCode === null && bystander.signalCode === null) {
        bystander.kill('SIGKILL')
        await sleep(200)
      }
      await ctx.fiber.dispose()
    }
  }, 60_000)

  it('leaves a signalable bystander untouched even when the transport reports its pid', async () => {
    const ctx = await mountRegistry()
    const errors = captureErrors(ctx)
    const bystander = liveChild()
    if (bystander.pid === undefined) throw new Error('expected the fixture child to report a pid')
    try {
      mockClose.mockImplementation(() => Promise.resolve())
      // A transport that exits "cleanly" yet never surfaces closure is the shape
      // that made the removed reaper fire: the pid it exposed was already free.
      mockCreateTransport.mockReturnValue({ pid: 2147483647, close: async () => {} })
      const handle = startConnection(ctx, stdioConfig(), resolveReconnectPolicy({ enabled: false }, 'disposal'))
      try {
        await expect(handle.ready).resolves.toEqual({})
        await handle.dispose()
        expect(bystander.exitCode).toBeNull()
        expect(bystander.signalCode).toBeNull()
        expect(errors.some(line => line.includes('transport closure could not be confirmed'))).toBe(true)
      } finally {
        await handle.dispose()
      }
    } finally {
      if (bystander.exitCode === null && bystander.signalCode === null) {
        bystander.kill('SIGKILL')
        await sleep(200)
      }
      await ctx.fiber.dispose()
    }
  }, 60_000)
})
