import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies, provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as HooksCodex from '@deepseek-ai/dsh-hooks-codex'
import { ALL_HOOKS } from '@deepseek-ai/dsh-hook-protocol'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function writeHooks(hooks: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-codex-mandatory-'))
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
  await ctx.plugin(HooksCodex, { configPath: join(dir, 'hooks.json'), model: 'm', enabledHooks: [ALL_HOOKS], mandatory })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

const UPDATED_INPUT_COMMAND = 'node -e "console.log(JSON.stringify({hookSpecificOutput:{hookEventName:\'PreToolUse\',permissionDecision:\'allow\',updatedInput:{file_path:\'x\'}}}))"'

describe('hooks-codex mandatory mode', () => {
  it('refuses activation when the config file is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-codex-mandatory-'))
    dirs.push(dir)
    await expect(harness(dir, new MockAdapter([]), true)).rejects.toThrow(/mandatory hook config .* is unusable/u)
    await expect(harness(dir, new MockAdapter([]), false)).resolves.toBeDefined()
  })

  it('refuses activation when the config has an unsupported handler', async () => {
    const dir = writeHooks({ PreToolUse: [{ hooks: [{ type: 'command', command: 'true', async: true }] }] })
    await expect(harness(dir, new MockAdapter([]), true)).rejects.toThrow(/unsupported handlers: PreToolUse: async hook/u)
    await expect(harness(dir, new MockAdapter([]), false)).resolves.toBeDefined()
  })

  it('denies a tool call whose hook requests updatedInput', async () => {
    const dir = writeHooks({ PreToolUse: [{ hooks: [{ type: 'command', command: UPDATED_INPUT_COMMAND }] }] })
    const run = async (mandatory: boolean): Promise<boolean> => {
      const ctx = await harness(dir, new MockAdapter([toolCallResponse('c1', 'danger', { file_path: 'a.txt' }), textResponse('done')]), mandatory)
      const state = { ran: false }
      ctx.tools.register(defineContentToolFixture({
        name: 'danger',
        description: 'd',
        parameters: { file_path: { type: 'string' } },
        async execute() { state.ran = true; return [{ type: 'text', text: 'ran' }] },
      }))
      const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      return state.ran
    }
    expect(await run(true)).toBe(false)
    expect(await run(false)).toBe(true)
  }, 30_000)
})
