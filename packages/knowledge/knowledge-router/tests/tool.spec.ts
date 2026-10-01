import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { registerKnowledgeTool } from '../src/tool.ts'
import type { KnowledgePacket, RetrieveOptions } from '../src/types.ts'

const packet: KnowledgePacket = {
  task: 'task',
  providers: ['graphify'],
  unavailable: [],
  items: [],
  bytes: 0,
  truncated: false,
}

function register(retrieve: (task: string, options: RetrieveOptions) => Promise<KnowledgePacket>): ToolDefinition {
  const definitions: ToolDefinition[] = []
  const ctx = {
    tools: { register: (definition: ToolDefinition) => definitions.push(definition) },
  } as unknown as Context
  registerKnowledgeTool(ctx, { retrieve })
  const definition = definitions[0]
  if (definition === undefined) throw new Error('knowledge_query was not registered')
  return definition
}

describe('knowledge_query', () => {
  it('passes explicit providers and the calling agent into retrieval', async () => {
    let received: { task: string; options: RetrieveOptions } | undefined
    const definition = register(async (task, options) => {
      received = { task, options }
      return packet
    })
    const agent = { id: 'agent-1' } as Agent
    const exec = { agent, signal: new AbortController().signal } as ToolRunContext
    await definition.execute({ task: 'Find prior graph context', providers: ['graphify'] }, exec)
    expect(received?.task).toBe('Find prior graph context')
    expect(received?.options).toMatchObject({
      providers: ['graphify'], agent, requestedBy: 'agent-1', execution: exec, signal: exec.signal,
    })
  })

  it('renders the packet returned by retrieval', () => {
    const definition = register(async () => Promise.resolve(packet))
    const value = {
      task: 'task',
      providers: ['graphify'],
      unavailable: [],
      items: [],
      bytes: 0,
      truncated: false,
    }
    expect(JSON.stringify(definition.output.render({}, value))).toContain('queried: graphify')
  })
})
