import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { registerKnowledgeLearnTool } from '../src/tool-learn.ts'

function register(): ToolDefinition {
  const definitions: ToolDefinition[] = []
  const ctx = {
    tools: { register: (definition: ToolDefinition) => definitions.push(definition) },
  } as unknown as Context
  registerKnowledgeLearnTool(ctx, {
    learn: async () => ({ outcome: 'useful', reflected: true, stdout: 'saved' }),
  })
  const definition = definitions[0]
  if (definition === undefined) throw new Error('knowledge_record was not registered')
  return definition
}

describe('knowledge_record', () => {
  it('renders reflection failures without hiding the failure detail', () => {
    const [block] = register().output.render({}, {
      outcome: 'useful', reflected: false, stdout: 'ignored', reflectionError: 'Graphify unavailable',
    })
    expect(block).toEqual({
      type: 'text',
      text: 'recorded a useful finding; reflection skipped; reflection failed: Graphify unavailable',
    })
  })

  it('renders a skipped reflection when the saved output is blank', () => {
    const [block] = register().output.render({}, { outcome: 'dead_end', reflected: false, stdout: '  \n' })
    expect(block).toEqual({ type: 'text', text: 'recorded a dead_end finding; reflection skipped' })
  })

  it('renders successful reflection output', () => {
    const [block] = register().output.render({}, { outcome: 'corrected', reflected: true, stdout: '  persisted  \n' })
    expect(block).toEqual({ type: 'text', text: 'recorded a corrected finding; reflection ran\npersisted' })
  })

  it('passes optional correction and node references to the learning service', async () => {
    let received: unknown
    const definitions: ToolDefinition[] = []
    const ctx = {
      tools: { register: (definition: ToolDefinition) => definitions.push(definition) },
    } as unknown as Context
    registerKnowledgeLearnTool(ctx, {
      learn: async (write) => {
        received = write
        return { outcome: 'corrected', reflected: false, stdout: '' }
      },
    })
    const definition = definitions[0]
    if (definition === undefined) throw new Error('knowledge_record was not registered')
    await definition.execute({
      question: 'Q', answer: 'A', outcome: 'corrected', correction: 'B', nodes: ['closeSession()'], validated_by: 'reviewer',
    }, { signal: new AbortController().signal } as ToolRunContext)
    expect(received).toEqual({
      question: 'Q', answer: 'A', outcome: 'corrected', correction: 'B', nodes: ['closeSession()'], validatedBy: 'reviewer',
    })
  })
})
