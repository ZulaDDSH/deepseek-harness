import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { unknownToolHint } from '../src/index.ts'
import type { ToolDefinition, ToolExecutionResult } from '../src/index.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'

const testToolSignal = new AbortController().signal

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  return ctx
}

async function mintAgentScope(ctx: Context, name: string): Promise<{ scope: Scope; key: Agent }> {
  const key = { id: name as SessionId } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) },
    { inject: ['tools', 'systemPrompt'] }))
  return { scope, key }
}

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: (): Promise<string> => Promise.resolve(`ran:${name}`),
  }
}

async function execute(ctx: Context, name: string, agent?: Agent): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId('c1'),
    name,
    arguments: {},
    ...agent ? { agent } : {},
  })
}

async function text(ctx: Context, name: string, agent?: Agent): Promise<string> {
  const result = await execute(ctx, name, agent)
  const first = result.content[0]
  return first?.type === 'text' ? first.text : JSON.stringify(result.content)
}

describe('unknown tool diagnostics', () => {
  it('suggests the same MCP server first, nearest first, and keeps the UNKNOWN_TOOL code', async () => {
    const ctx = await mount()
    for (const name of ['mcp__github__get_issue', 'mcp__github__list_issues', 'read', 'write']) {
      ctx.tools.register(tool(name))
    }

    expect(await text(ctx, 'mcp__github__get_isue')).toBe(
      'Error: unknown tool "mcp__github__get_isue": did you mean mcp__github__get_issue, mcp__github__list_issues?',
    )
    expect((await execute(ctx, 'mcp__github__get_isue')).error?.info?.code).toBe('UNKNOWN_TOOL')
  })

  it('reports an MCP server with no available tools', async () => {
    const ctx = await mount()
    ctx.tools.register(tool('mcp__github__get_issue'))

    expect(await text(ctx, 'mcp__jira__search')).toBe(
      'Error: unknown tool "mcp__jira__search": MCP server "jira" has no available tools (disconnected?)',
    )
  })

  it('suggests a visible tool that differs only by case', async () => {
    const ctx = await mount()
    ctx.tools.register(tool('read'))
    ctx.tools.register(tool('write'))

    expect(await text(ctx, 'Read')).toBe('Error: unknown tool "Read": did you mean read?')
  })

  it('keeps a name with no near match bare', async () => {
    const ctx = await mount()
    ctx.tools.register(tool('read'))

    expect(await text(ctx, 'zzzzzzzz')).toBe('Error: unknown tool "zzzzzzzz"')
  })

  it('suggests only tools visible to the calling agent', async () => {
    const ctx = await mount()
    const { scope, key } = await mintAgentScope(ctx, 'a')
    const other = { id: 'other' as SessionId } as Agent
    scope.ctx.tools.register(tool('mine_tool'))

    expect(await text(ctx, 'mine_too', key)).toBe('Error: unknown tool "mine_too": did you mean mine_tool?')
    expect(await text(ctx, 'mine_too', other)).toBe('Error: unknown tool "mine_too"')
  })
})

describe('unknownToolHint', () => {
  it('matches a shorter visible name that contains the requested one', () => {
    expect(unknownToolHint('web', ['web_fetch'])).toBe('did you mean web_fetch?')
  })

  it('truncates the suggestions to five', () => {
    const visible = ['tool_a', 'tool_b', 'tool_c', 'tool_d', 'tool_e', 'tool_f', 'tool_g']

    expect(unknownToolHint('tool', visible)).toBe('did you mean tool_a, tool_b, tool_c, tool_d, tool_e?')
  })

  it('breaks distance ties by name, whatever the visible order', () => {
    expect(unknownToolHint('tool', ['tool_c', 'tool_a', 'tool_b'])).toBe('did you mean tool_a, tool_b, tool_c?')
  })

  it('returns undefined when nothing is visible', () => {
    expect(unknownToolHint('read', [])).toBeUndefined()
  })
})
