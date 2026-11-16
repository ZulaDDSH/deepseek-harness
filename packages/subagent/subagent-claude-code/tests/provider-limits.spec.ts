import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as claudeCode from '../src/index.ts'
import {
  DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
  claudeQueryOptions,
  startClaudeCodeRun,
  type ClaudeCodeRunSpec,
} from '../src/run.ts'
import { fakeChild, sdkSpawnOptions, type FakeChild } from './claude-fakes.ts'
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'

type QueryFactory = (params: {
  prompt: string
  options: Options
}) => Query

const queryMock = vi.hoisted(() => vi.fn<QueryFactory>())

vi.mock('@anthropic-ai/claude-agent-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>(),
  query: queryMock,
}))

const fakeParent: Agent = {
  id: 'parent',
  session: { header: { cwd: process.cwd() } },
} as never

function waitingQuery(signal: AbortSignal): Query {
  async function* stream(): AsyncGenerator<SDKMessage, void> {
    yield { type: 'system', subtype: 'init' } as SDKMessage
    await new Promise<never>((_resolve, reject) => {
      const fail = (): void => {
        reject(signal.reason instanceof Error
          ? signal.reason
          : new Error(String(signal.reason)))
      }
      if (signal.aborted) fail()
      else signal.addEventListener('abort', fail, { once: true })
    })
  }
  return Object.assign(stream(), { close: vi.fn() }) as never
}

function baseSpec(child: FakeChild = fakeChild()): ClaudeCodeRunSpec {
  return {
    cwd: process.cwd(),
    permissionMode: DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
    env: {},
    disposeGraceMs: 5,
    spawn: () => child.handle,
  }
}

function startRun(spec: ClaudeCodeRunSpec, signal = new AbortController().signal) {
  return startClaudeCodeRun({
    prompt: [{ type: 'text', text: 't' }],
    parent: fakeParent,
    signal,
  }, spec)
}

afterEach(() => {
  vi.useRealTimers()
  queryMock.mockReset()
})

describe('run limits', () => {
  it('validates timeoutMs, maxTurns and maxBudgetUsd through Config and plugin admission', async () => {
    expect(claudeCode.Config({ timeoutMs: 1000, maxTurns: 3, maxBudgetUsd: 1.5 }))
      .toMatchObject({ timeoutMs: 1000, maxTurns: 3, maxBudgetUsd: 1.5 })
    const bare = claudeCode.Config({})
    expect(bare).not.toHaveProperty('timeoutMs')
    expect(bare).not.toHaveProperty('maxTurns')
    expect(bare).not.toHaveProperty('maxBudgetUsd')
    expect(() => claudeCode.Config({ maxTurns: 0 })).toThrow()

    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await expect(ctx.plugin(claudeCode, { timeoutMs: 0 }))
      .rejects.toThrow('timeoutMs must be a positive finite number')
    await expect(ctx.plugin(claudeCode, { timeoutMs: MAX_TIMER_DELAY_MS + 1 }))
      .rejects.toThrow(`timeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
    await expect(ctx.plugin(claudeCode, { maxBudgetUsd: 0 }))
      .rejects.toThrow('maxBudgetUsd must be a positive finite number')
  })

  it('passes maxTurns and maxBudgetUsd to the SDK options only when configured', () => {
    const limited = claudeQueryOptions(
      { ...baseSpec(), maxTurns: 3, maxBudgetUsd: 1.5 },
      new AbortController(),
      () => {},
      () => {},
    )
    expect(limited).toMatchObject({ maxTurns: 3, maxBudgetUsd: 1.5 })

    const bare = claudeQueryOptions(baseSpec(), new AbortController(), () => {}, () => {})
    expect(bare).not.toHaveProperty('maxTurns')
    expect(bare).not.toHaveProperty('maxBudgetUsd')
  })

  it('cancels the published run at timeoutMs and settles it as a limit error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const captured: { controller?: AbortController } = {}
    queryMock.mockImplementation(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      captured.controller = options.abortController!
      return waitingQuery(options.abortController!.signal)
    })
    const run = await startRun({ ...baseSpec(), timeoutMs: 1000 })

    vi.advanceTimersByTime(999)
    const sentinel = Symbol('pending')
    await expect(Promise.race([run.result, Promise.resolve(sentinel)]))
      .resolves.toBe(sentinel)

    vi.advanceTimersByTime(1)
    const settled = await run.result
    expect(settled).toMatchObject({ output: [], stopReason: 'error' })
    expect(settled.diagnostic).toContain('category: limit; detail: exceeded timeoutMs (1000 ms)')
    expect(captured.controller?.signal.aborted).toBe(true)
    await run.dispose()
  })

  it('settles a request abort before the limit as aborted and leaves no timer behind', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    queryMock.mockImplementation(({ options }) => {
      options.spawnClaudeCodeProcess!(sdkSpawnOptions())
      return waitingQuery(options.abortController!.signal)
    })
    const requestController = new AbortController()
    const run = await startRun({ ...baseSpec(), timeoutMs: 1000 }, requestController.signal)
    expect(vi.getTimerCount()).toBe(1)

    requestController.abort()
    await expect(run.result).resolves.toStrictEqual({ output: [], stopReason: 'aborted' })
    expect(vi.getTimerCount()).toBe(0)
    await run.dispose()
  })
})
