import { createUserMessage, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as HooksClaude from '@deepseek-ai/dsh-hooks-claude-code'
import { ALL_HOOKS, hookKey, type HookInventoryReport } from '@deepseek-ai/dsh-hook-protocol'
import { MockAdapter, maxTokensResponse, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Bridge tests for prompt hooks. The scripted mock model answers both the agent
 * loop and each hook's model call, in script order, so every reply a hook consumes
 * sits between the agent's own steps. Prompt hooks spawn no process.
 */

const PROMPT = 'Is this tool call safe? $ARGUMENTS'
const failure = { message: 'provider down', code: 'provider' }
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

async function harness(
  configDir: string,
  adapter: MockAdapter,
  enabledHooks: string[] = [ALL_HOOKS],
): Promise<{ ctx: Context; warn: Mock }> {
  const ctx = new Context()
  const warn = vi.fn()
  ctx.logger.warn = warn as never
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
  await ctx.plugin(HooksClaude, { configPath: join(configDir, 'hooks.json'), enabledHooks })
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, warn }
}

function writeHooks(hooks: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-prompt-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks }))
  return dir
}

function danger(extra: Record<string, unknown> = {}): unknown {
  return { matcher: 'danger', hooks: [{ type: 'prompt', prompt: PROMPT, ...extra }] }
}

function registerDanger(ctx: Context): { ran: boolean } {
  const state = { ran: false }
  ctx.tools.register(defineContentToolFixture({
    name: 'danger',
    description: 'd',
    parameters: { file_path: { type: 'string' } },
    async execute() { state.ran = true; return [{ type: 'text', text: 'ran' }] },
  }))
  return state
}

function ask(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function events(agent: Agent): readonly SessionEvent[] {
  return agent.session.snapshotEvents()
}

function hookResult(agent: Agent): SessionEvent | undefined {
  return events(agent).find(e => e.type === 'hook/result')
}

describe('hooks-claude-code prompt hooks — PreToolUse', () => {
  it('an ok:false verdict denies the tool and ends the turn, with the hook input in a tool-less model call', async () => {
    const dir = writeHooks({ PreToolUse: [danger()] })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'danger', { file_path: 'a.txt' }),
      textResponse('{"ok": false, "reason": "too risky"}'),
    ])
    const { ctx } = await harness(dir, adapter)
    const tool = registerDanger(ctx)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ask(agent, 'use danger')
    await agent.whenIdle()

    expect(tool.ran).toBe(false)
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[1]!.tools).toBeUndefined()
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('a.txt')
    expect(JSON.stringify(adapter.requests[1]!.messages)).not.toContain('$ARGUMENTS')
    expect(events(agent).filter(e => e.type === 'hook/invoked')).toHaveLength(1)
    const result = events(agent).find(e => e.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.message.isError).toBe(true)
    const turnEnd = events(agent).findLast(e => e.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'hook', reason: 'too risky' } })
  }, 15_000)

  it('an ok:true verdict lets the tool run and records a passing hook', async () => {
    const dir = writeHooks({ PreToolUse: [danger()] })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'danger', { file_path: 'a.txt' }),
      textResponse('{"ok": true}'),
      textResponse('done'),
    ])
    const { ctx } = await harness(dir, adapter)
    const tool = registerDanger(ctx)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ask(agent, 'use danger')
    await agent.whenIdle()

    expect(tool.ran).toBe(true)
    expect(adapter.requests).toHaveLength(3)
    const record = hookResult(agent)
    expect(record?.type === 'hook/result' && record.data.decision).toBe('pass')
  }, 15_000)

  it('continueOnBlock denies the tool but lets the turn continue to its next step', async () => {
    const dir = writeHooks({ PreToolUse: [danger({ continueOnBlock: true })] })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'danger', { file_path: 'a.txt' }),
      textResponse('{"ok": false, "reason": "no"}'),
      textResponse('done'),
    ])
    const { ctx } = await harness(dir, adapter)
    const tool = registerDanger(ctx)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ask(agent, 'use danger')
    await agent.whenIdle()

    expect(tool.ran).toBe(false)
    expect(adapter.requests).toHaveLength(3)
    const result = events(agent).find(e => e.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.message.isError).toBe(true)
  }, 15_000)

  it.each<[string, StreamChunk[], string]>([
    ['an error finish', [{ type: 'finish', reason: { kind: 'error', failure } }], 'provider down'],
    ['an aborted finish', [{ type: 'finish', reason: { kind: 'aborted', failure } }], 'provider down'],
    ['a max-tokens cutoff', maxTokensResponse('{"ok": false'), 'ended with max-tokens'],
    ['text with no JSON object', textResponse('I cannot decide'), 'prompt hook reply has no JSON object'],
    [
      'no terminal finish',
      [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: '{"ok": true}' }],
      'no terminal finish',
    ],
  ])('a model reply with %s fails open with a warning and a passing failed record', async (_name, reply, expected) => {
    const dir = writeHooks({ PreToolUse: [danger()] })
    const adapter = new MockAdapter([toolCallResponse('c1', 'danger', { file_path: 'a.txt' }), reply, textResponse('done')])
    const { ctx, warn } = await harness(dir, adapter)
    const tool = registerDanger(ctx)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ask(agent, 'use danger')
    await agent.whenIdle()

    expect(tool.ran).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PreToolUse prompt hook did not decide, so the action proceeds'))
    const record = hookResult(agent)
    expect(record?.type === 'hook/result' && record.data.decision).toBe('pass')
    expect(record?.type === 'hook/result' && record.data.stderrSummary).toContain(expected)
  }, 15_000)

  it('a prompt hook that outlives its timeout fails open with a timeout record', async () => {
    const dir = writeHooks({ PreToolUse: [danger({ timeout: 0.1 })] })
    const adapter = new MockAdapter([toolCallResponse('c1', 'danger', { file_path: 'a.txt' }), 'hang', textResponse('done')])
    const { ctx, warn } = await harness(dir, adapter)
    const tool = registerDanger(ctx)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ask(agent, 'use danger')
    await agent.whenIdle()

    expect(tool.ran).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PreToolUse prompt hook timed out after 100 ms'))
    const record = hookResult(agent)
    expect(record?.type === 'hook/result' && record.data.stderrSummary).toContain('timed out after 100 ms')
  }, 15_000)

  it('a hook model that resolves on the route is the model the hook call uses', async () => {
    const dir = writeHooks({ PreToolUse: [danger({ model: 'mock-small' })] })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'danger', { file_path: 'a.txt' }),
      textResponse('{"ok": true}'),
      textResponse('done'),
    ])
    const { ctx, warn } = await harness(dir, adapter)
    registerDanger(ctx)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ask(agent, 'use danger')
    await agent.whenIdle()

    expect(adapter.requests[1]!.model).toBe('mock-small')
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('does not resolve'))
  }, 15_000)

  it('a hook model that does not resolve falls back to the agent model with a warning', async () => {
    const dir = writeHooks({ PreToolUse: [danger({ model: 'missing-model' })] })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'danger', { file_path: 'a.txt' }),
      textResponse('{"ok": true}'),
      textResponse('done'),
    ])
    const resolve = adapter.resolveModel.bind(adapter)
    vi.spyOn(adapter, 'resolveModel').mockImplementation((provider, model) =>
      model === 'missing-model' ? Promise.reject(new Error('no such model')) : resolve(provider, model))
    const { ctx, warn } = await harness(dir, adapter)
    registerDanger(ctx)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ask(agent, 'use danger')
    await agent.whenIdle()

    expect(adapter.requests[1]!.model).toBe('mock')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('prompt hook model "missing-model" does not resolve on provider "mock"'))
  }, 15_000)

  it('a prompt hook on a direct call with no agent fails open without a model call', async () => {
    const dir = writeHooks({ PreToolUse: [{ hooks: [{ type: 'prompt', prompt: PROMPT }] }] })
    const adapter = new MockAdapter([])
    const { ctx, warn } = await harness(dir, adapter)
    const tool = registerDanger(ctx)
    const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('c1'), name: 'danger', arguments: { file_path: 'a.txt' } })

    expect(tool.ran).toBe(true)
    expect(result.isError).toBe(false)
    expect(adapter.requests).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no calling agent supplies a model route'))
  }, 15_000)

  it('a prompt hook on an agent with no model route fails open without a model call', async () => {
    const dir = writeHooks({ PreToolUse: [danger()] })
    const adapter = new MockAdapter([])
    const { ctx, warn } = await harness(dir, adapter)
    const tool = registerDanger(ctx)
    const agent = await ctx.agentLoop.create(SessionId('a2'), {})
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('c1'),
      name: 'danger',
      arguments: { file_path: 'a.txt' },
      agent,
    })

    expect(tool.ran).toBe(true)
    expect(result.isError).toBe(false)
    expect(adapter.requests).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the calling agent has no provider and model route'))
  }, 15_000)

  it('a prompt hook with no llm service fails open with a warning and the tool runs', async () => {
    const dir = writeHooks({ PreToolUse: [danger()] })
    const adapter = new MockAdapter([toolCallResponse('c1', 'danger', { file_path: 'a.txt' }), textResponse('done')])
    const { ctx, warn } = await harness(dir, adapter)
    const tool = registerDanger(ctx)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    const get = ctx.get.bind(ctx)
    // oxlint-disable-next-line typescript/no-unsafe-return -- Mock implementation delegates to bound Cordis get.
    vi.spyOn(ctx, 'get').mockImplementation((name: string, strict?: boolean) => name === 'llm' ? undefined : get(name, strict))
    ask(agent, 'use danger')
    await agent.whenIdle()

    expect(tool.ran).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PreToolUse prompt hook did not decide, so the action proceeds: Error: no llm service is available to run prompt hooks'))
    expect(adapter.requests).toHaveLength(2)
  }, 15_000)

  it('a prompt hook whose key is not enabled is not evaluated and is reported disabled', async () => {
    const dir = writeHooks({ PreToolUse: [danger()] })
    const adapter = new MockAdapter([toolCallResponse('c1', 'danger', { file_path: 'a.txt' }), textResponse('done')])
    const { ctx } = await harness(dir, adapter, [])
    const tool = registerDanger(ctx)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ask(agent, 'use danger')
    await agent.whenIdle()

    expect(tool.ran).toBe(true)
    expect(adapter.requests).toHaveLength(2)
    expect(events(agent).some(e => e.type === 'hook/invoked')).toBe(false)
    const reports: HookInventoryReport[] = []
    ctx.emit('hooks/inventory', reports)
    expect(reports[0]?.handlers).toEqual([expect.objectContaining({ event: 'PreToolUse', matcher: 'danger', disabled: true })])
  }, 15_000)

  it('the inventory keys a prompt hook by its matcher and prompt text, the same key that enables it', async () => {
    const dir = writeHooks({ PreToolUse: [danger()] })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'danger', { file_path: 'a.txt' }),
      textResponse('{"ok": true}'),
      textResponse('done'),
    ])
    const { ctx } = await harness(dir, adapter, [hookKey('PreToolUse', 'danger', PROMPT)])
    const tool = registerDanger(ctx)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ask(agent, 'use danger')
    await agent.whenIdle()

    expect(tool.ran).toBe(true)
    expect(adapter.requests).toHaveLength(3)
    const reports: HookInventoryReport[] = []
    ctx.emit('hooks/inventory', reports)
    expect(reports[0]?.handlers).toEqual([{
      event: 'PreToolUse',
      command: PROMPT,
      key: hookKey('PreToolUse', 'danger', PROMPT),
      matcher: 'danger',
    }])
  }, 15_000)
})

describe('hooks-claude-code prompt hooks — Stop and UserPromptSubmit', () => {
  it('a Stop prompt hook with ok:false steers the agent to continue, and ok:true then ends the turn', async () => {
    const dir = writeHooks({ Stop: [{ hooks: [{ type: 'prompt', prompt: 'Is the work finished?' }] }] })
    const adapter = new MockAdapter([
      textResponse('one'),
      textResponse('{"ok": false, "reason": "keep going"}'),
      textResponse('two'),
      textResponse('{"ok": true}'),
    ])
    const { ctx } = await harness(dir, adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ask(agent, 'go')
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(4)
    expect(JSON.stringify(adapter.requests[2]!.messages)).toContain('keep going')
  }, 15_000)

  it('an impossible Stop prompt verdict halts the turn instead of steering', async () => {
    const dir = writeHooks({ Stop: [{ hooks: [{ type: 'prompt', prompt: 'Is the work finished?' }] }] })
    const adapter = new MockAdapter([
      textResponse('one'),
      textResponse('{"ok": false, "reason": "never", "impossible": true}'),
    ])
    const { ctx } = await harness(dir, adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ask(agent, 'go')
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    const turnEnd = events(agent).findLast(e => e.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'hook', reason: 'never' } })
  }, 15_000)

  it('a UserPromptSubmit prompt hook with ok:false rejects the prompt before any main model step', async () => {
    const dir = writeHooks({ UserPromptSubmit: [{ hooks: [{ type: 'prompt', prompt: 'Allow this prompt?' }] }] })
    const adapter = new MockAdapter([textResponse('{"ok": false, "reason": "policy"}')])
    const { ctx } = await harness(dir, adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ask(agent, 'go')
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    const record = hookResult(agent)
    expect(record?.type === 'hook/result' && record.data.decision).toBe('deny')
    const turnEnd = events(agent).findLast(e => e.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'hook', reason: 'policy' } })
  }, 15_000)
})
