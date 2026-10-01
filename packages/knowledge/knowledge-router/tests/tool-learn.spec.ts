import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { registerKnowledgeLearnTool } from '../src/tool-learn.ts'
import type { LearningResult, LearningWrite } from '../src/graphify-learn.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

async function register(learn: (write: LearningWrite) => Promise<LearningResult>): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  registerKnowledgeLearnTool(ctx, { learn })
  context = ctx
  return ctx
}

async function render(result: LearningResult): Promise<string> {
  const ctx = await register(async () => result)
  const call = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('knowledge-record-render'),
    name: 'knowledge_record',
    arguments: { question: 'Q', answer: 'A', outcome: result.outcome, validated_by: 'reviewer' },
  })
  return call.content.map(block => block.type === 'text' ? block.text : '').join('')
}

describe('knowledge_record', () => {
  it('renders reflection failures without hiding the failure detail', async () => {
    expect(await render({ outcome: 'useful', reflected: false, stdout: 'ignored', reflectionError: 'Graphify unavailable' }))
      .toBe('recorded a useful finding; reflection skipped; reflection failed: Graphify unavailable')
  })

  it('renders a skipped reflection when the saved output is blank', async () => {
    expect(await render({ outcome: 'dead_end', reflected: false, stdout: '  \n' }))
      .toBe('recorded a dead_end finding; reflection skipped')
  })

  it('renders successful reflection output', async () => {
    expect(await render({ outcome: 'corrected', reflected: true, stdout: '  persisted  \n' }))
      .toBe('recorded a corrected finding; reflection ran\npersisted')
  })

  it('passes optional correction and node references to the learning service', async () => {
    let received: unknown
    const ctx = await register(async (write) => {
      received = write
      return { outcome: 'corrected', reflected: false, stdout: '' }
    })
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('knowledge-record-write'),
      name: 'knowledge_record',
      arguments: {
        question: 'Q', answer: 'A', outcome: 'corrected', correction: 'B',
        nodes: ['closeSession()'], validated_by: 'reviewer',
      },
    })
    expect(received).toEqual({
      question: 'Q', answer: 'A', outcome: 'corrected', correction: 'B',
      nodes: ['closeSession()'], validatedBy: 'reviewer',
    })
  })
})
