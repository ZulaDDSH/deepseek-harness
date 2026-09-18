import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

const { mockConnect, mockClose, mockListTools, MockClient } = vi.hoisted(() => {
  const mockConnect = vi.fn<() => Promise<void>>()
  const mockClose = vi.fn<() => Promise<void>>()
  const mockListTools = vi.fn<() => Promise<unknown>>()
  class MockClient {
    transport = {}
    connect = mockConnect
    close = mockClose
    listTools = mockListTools
    callTool = vi.fn()
    getServerCapabilities = () => ({ tools: {} })
    getInstructions = () => 'Large server guidance'
  }
  return { mockConnect, mockClose, mockListTools, MockClient }
})

vi.mock('@modelcontextprotocol/client', () => ({
  Client: MockClient,
  StreamableHTTPClientTransport: vi.fn(),
}))

vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: vi.fn(),
}))

import * as McpClient from '@deepseek-ai/dsh-mcp-client'

let root: string | undefined
let context: Context | undefined

beforeEach(() => {
  mockConnect.mockReset()
  mockClose.mockReset()
  mockListTools.mockReset()
  mockConnect.mockResolvedValue(undefined)
  mockClose.mockImplementation(function (this: { onclose?: () => void }) {
    this.onclose?.()
    return Promise.resolve()
  })
  mockListTools.mockResolvedValue({
    tools: [
      { name: 'remote', inputSchema: { type: 'object' } },
      { name: 'blocked', inputSchema: { type: 'object' } },
      { name: 'other', inputSchema: { type: 'object' } },
    ],
  })
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-mcp-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    transport: stdio',
    '    serverName: srv',
    '    command: echo',
    '    maxInstructionBytes: 1',
    '    includeServerInstructions: false',
    '    toolFilter:',
    '      allow: [remote, blocked]',
    '      deny: [blocked]',
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-mcp-client', McpClient],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('mcp-client real Loader composition', () => {
  it('filters tool schemas and omits server instructions from YAML config', async () => {
    const loaded = await loadYaml()

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(loaded.tools.schemas().map(schema => schema.name)).toEqual(['mcp__srv__remote'])
    const prompt = renderPrompt(await loaded.systemPrompt.assemble())
    expect(prompt).not.toContain('Large server guidance')
    expect(prompt).not.toContain('### MCP server:')
  })
})
