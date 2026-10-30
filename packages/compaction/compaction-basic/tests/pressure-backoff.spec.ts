import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { SessionId } from '@deepseek-ai/dsh-session'

/** Each call emits one tool-call until exhausted, then a final text answer. */
class StepwiseToolAdapter extends LlmAdapter {
  calls = 0
  constructor(private toolSteps: number) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 400 },
    })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const n = this.calls
    this.calls += 1
    if (n < this.toolSteps) {
      const id = ToolCallId(`c${n}`)
      const args = `{"i":${n}}`
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: `step ${n}` } }
      yield { type: 'block-start', index: 1, blockType: 'tool-call' }
      yield { type: 'block-end', index: 1, block: { type: 'tool-call', id, name: 'work', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'all done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Pressure attempts follow `script` in order (missing entries fail); each records the step count it ran at. */
class ScriptedPressureEngine extends BasicCompactionEngine {
  script: Array<'fail' | 'ok'> = []
  readonly callSteps: number[] = []
  override compactIfNeeded(agent: Agent, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null> {
    if (trigger !== 'pressure') return super.compactIfNeeded(agent, trigger, signal)
    this.callSteps.push(agent.session.snapshotEvents().filter(event => event.type === 'step/start').length)
    return (this.script.shift() ?? 'fail') === 'fail'
      ? Promise.reject(new Error('summarizer unavailable'))
      : Promise.resolve(null)
  }
}

async function run(script: Array<'fail' | 'ok'>, toolSteps: number): Promise<number[]> {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    ctx.llm.registerAdapter(['mock'], new StepwiseToolAdapter(toolSteps))
    ctx.tools.register(defineContentToolFixture({
      name: 'work',
      description: 'does work',
      parameters: { i: { type: 'number' } },
      async execute() {
        return [{ type: 'text', text: 'work result' }]
      },
    }))
    const compact = new ScriptedPressureEngine(ctx, {})
    compact.script = script
    const agent = await ctx.agentLoop.create(SessionId('pressure-backoff'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do a multi-step task' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    return compact.callSteps
  } finally {
    await ctx.fiber.dispose()
  }
}

const gaps = (steps: number[]): number[] => steps.slice(1).map((step, index) => step - steps[index]!)

describe('pressure compaction backoff', () => {
  it('backs off exponentially while pressure compaction keeps failing', async () => {
    const steps = await run([], 9)
    expect(gaps(steps)).toEqual([3, 5])
  })

  it('resets the backoff after a successful pressure pass', async () => {
    const steps = await run(['fail', 'ok', 'fail', 'fail'], 9)
    expect(gaps(steps)).toEqual([3, 1, 3])
  })
})
