/** @module @deepseek-ai/dsh-knowledge-router/tool */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PROVIDER_NAMES } from './provider.ts'
import { renderPacket } from './packet.ts'
import type { KnowledgePacket, RetrieveOptions } from './types.ts'

/** What the tool needs from the router that owns it. */
export interface KnowledgeQueryTarget {
  /**
   * Retrieve a bounded packet for one task.
   * @param task - the task text to route and query.
   * @param options - explicit providers, caller source references, and cancellation.
   * @returns the bounded packet.
   */
  retrieve(task: string, options: RetrieveOptions): Promise<KnowledgePacket>
}

const DESCRIPTION = 'Retrieve bounded knowledge about a task from the configured knowledge providers. '
  + 'Code-intelligence providers answer structural questions about the codebase, such as what calls a symbol, what a change affects, or which execution flow contains it. '
  + 'Learned-knowledge providers answer what earlier work established, corrected, or abandoned. '
  + 'Omit providers to let the harness route the task; a task that names no routing cue retrieves nothing, and no provider is queried twice. '
  + 'Only bounded excerpts are returned, each with its source and freshness. Treat any result marked stale as requiring verification before you rely on it.'

/**
 * Register the knowledge tool on the calling context.
 * @param ctx - context whose `tools` registry receives the definition.
 * @param target - the router that performs retrieval.
 */
export function registerKnowledgeTool(ctx: Context, target: KnowledgeQueryTarget): void {
  ctx.tools.register(defineTool({
    name: 'knowledge_query',
    description: DESCRIPTION,
    parameters: {
      task: {
        type: 'string',
        required: true,
        description: 'The question or task to retrieve knowledge for. Pass the task text as written; the router classifies it.',
      },
      providers: {
        type: 'array',
        items: { type: 'string', enum: PROVIDER_NAMES },
        description: 'Providers to query explicitly, overriding automatic routing. Omit to route the task.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task: { type: 'string', required: true },
          requestedBy: { type: 'string' },
          providers: { type: 'array', required: true, items: { type: 'string' } },
          unavailable: { type: 'array', required: true, items: { type: 'string' } },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                provider: { type: 'string', required: true },
                serverName: { type: 'string', required: true },
                task: { type: 'string', required: true },
                text: { type: 'string', required: true },
                freshness: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    kind: { type: 'string', required: true, enum: ['unknown', 'current', 'stale'] },
                    detail: { type: 'string' },
                  },
                },
                signals: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    lessonsObserved: { type: 'number', required: true },
                    staleLessons: { type: 'number', required: true },
                    lessonStatuses: { type: 'array', required: true, items: { type: 'string' } },
                  },
                },
                retrievedAt: { type: 'string', required: true },
              },
            },
          },
          bytes: { type: 'number', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderPacket(value) }],
    },
    async execute(args, exec) {
      return target.retrieve(args.task, {
        ...args.providers !== undefined ? { providers: args.providers } : {},
        ...exec.agent !== undefined ? { agent: exec.agent, requestedBy: String(exec.agent.id) } : {},
        execution: exec,
        signal: exec.signal,
      })
    },
  }))
}
