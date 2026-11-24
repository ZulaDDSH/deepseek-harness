import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies, provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as HooksClaude from '@deepseek-ai/dsh-hooks-claude-code'
import { ALL_HOOKS } from '@deepseek-ai/dsh-hook-protocol'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const failure = { message: 'provider down', code: 'provider' }
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function writeHooks(hooks: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-mandatory-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks }))
  return dir
}

async function harness(dir: string, adapter: MockAdapter, mandatory: boolean): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  provideWorkingDirectoryFixture(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
  await ctx.plugin(HooksClaude, { configPath: join(dir, 'hooks.json'), enabledHooks: [ALL_HOOKS], mandatory })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
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

async function runTurn(ctx: Context): Promise<Agent> {
  const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'use danger' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  return agent
}

const promptHook = (extra: Record<string, unknown>): unknown => ({ matcher: 'danger', hooks: [{ type: 'prompt', prompt: 'safe? $ARGUMENTS', ...extra }] })

const UPDATED_INPUT_COMMAND = 'node -e "console.log(JSON.stringify({hookSpecificOutput:{hookEventName:\'PreToolUse\',permissionDecision:\'allow\',updatedInput:{file_path:\'x\'}}}))"'

describe('hooks-claude-code mandatory mode', () => {
  it('refuses activation when the config file is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-claude-mandatory-'))
    dirs.push(dir)
    await expect(harness(dir, new MockAdapter([]), true)).rejects.toThrow(/mandatory hook config .* is unusable/u)
    await expect(harness(dir, new MockAdapter([]), false)).resolves.toBeDefined()
  })

  it('refuses activation when the config has an unsupported handler', async () => {
    const dir = writeHooks({ PreToolUse: [{ hooks: [{ type: 'http', url: 'http://localhost/x' }] }] })
    await expect(harness(dir, new MockAdapter([]), true)).rejects.toThrow(/unsupported handlers: PreToolUse: http/u)
    await expect(harness(dir, new MockAdapter([]), false)).resolves.toBeDefined()
  })

  it('denies a tool call whose hook requests updatedInput', async () => {
    const dir = writeHooks({ PreToolUse: [{ hooks: [{ type: 'command', command: UPDATED_INPUT_COMMAND }] }] })
    const run = async (mandatory: boolean): Promise<boolean> => {
      const ctx = await harness(dir, new MockAdapter([toolCallResponse('c1', 'danger', { file_path: 'a.txt' }), textResponse('done')]), mandatory)
      const tool = registerDanger(ctx)
      await runTurn(ctx)
      return tool.ran
    }
    expect(await run(true)).toBe(false)
    expect(await run(false)).toBe(true)
  }, 30_000)

  it.each<[string, StreamChunk[] | 'hang', Record<string, unknown>]>([
    ['a provider error', [{ type: 'finish', reason: { kind: 'error', failure } }], {}],
    ['a timeout', 'hang', { timeout: 0.1 }],
  ])('denies the tool when a prompt hook ends with %s', async (_name, reply, extra) => {
    const dir = writeHooks({ PreToolUse: [promptHook(extra)] })
    const ctx = await harness(dir, new MockAdapter([toolCallResponse('c1', 'danger', { file_path: 'a.txt' }), reply, textResponse('done')]), true)
    const tool = registerDanger(ctx)
    const agent = await runTurn(ctx)
    expect(tool.ran).toBe(false)
    const result = agent.session.snapshotEvents().find(e => e.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.message.isError).toBe(true)
  }, 30_000)
})
