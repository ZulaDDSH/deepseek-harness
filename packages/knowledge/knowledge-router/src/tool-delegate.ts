/** @module @deepseek-ai/dsh-knowledge-router/tool-delegate */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderPacket } from './packet.ts'
import type { KnowledgePacket, RetrieveOptions } from './types.ts'

/** What the tool needs from the router that owns it. */
export interface KnowledgeDelegateTarget {
  /**
   * Retrieve a bounded packet for one task.
   * @param task - the task text to route and query.
   * @param options - caller source references and cancellation.
   * @returns the bounded packet.
   */
  retrieve(task: string, options: RetrieveOptions): Promise<KnowledgePacket>
}

/** What one delegation produced. */
export interface KnowledgeDelegation {
  /** The durable child session id, reusable for follow-up messages. */
  readonly childId: string
  /** Providers that contributed knowledge, in query order. */
  readonly providers: string[]
  /** Providers a routing decision selected but that were unavailable. */
  readonly unavailable: string[]
  /** Whether the packet was shortened to fit its byte bound. */
  readonly truncated: boolean
}

/** What starting a continuable child needs from the subagent service. */
export interface DelegateStarter {
  /**
   * Start one continuable child with an already-composed prompt.
   * @param prompt - the child's initial user message.
   * @param label - the child's short creation label.
   * @param parent - the delegating agent.
   * @param signal - caller cancellation.
   * @returns the durable child id, reusable for follow-up messages.
   */
  start(prompt: string, label: string, parent: Agent, signal: AbortSignal): Promise<string>
}

const DESCRIPTION = 'Delegate a technical task to a worker that begins with a bounded knowledge packet. '
  + 'Prefer this over the plain subagent tool when the task is technical and code structure or earlier findings would change how it is approached: the harness retrieves only the knowledge the task warrants, bounded by the configured packet size, and passes it to the worker with the task. '
  + 'The worker is continuable, so send_message reaches the same child for follow-up and correction.'

/**
 * Register the delegation tool on the calling context.
 * @param ctx - context whose `tools` registry receives the definition, with `subagents` available.
 * @param target - the router that performs retrieval.
 * @param delegate - starts the continuable child.
 */
export function registerKnowledgeDelegateTool(
  ctx: Context,
  target: KnowledgeDelegateTarget,
  delegate: DelegateStarter,
): void {
  ctx.tools.register(defineTool({
    name: 'knowledge_delegate',
    description: DESCRIPTION,
    parameters: {
      description: {
        type: 'string',
        required: true,
        description: 'A short (3-5 word) description of the delegated task, for display.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'The complete, self-contained task for the worker. It does not share this conversation, so include everything it needs.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          childId: { type: 'string', required: true },
          providers: { type: 'array', required: true, items: { type: 'string' } },
          unavailable: { type: 'array', required: true, items: { type: 'string' } },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `delegated to agent ${value.childId}; knowledge from ${value.providers.join(', ') || 'no provider'}`,
      }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('knowledge_delegate requires a delegating agent')
      const packet = await target.retrieve(args.prompt, {
        agent: exec.agent,
        requestedBy: String(exec.agent.id),
        execution: exec,
        signal: exec.signal,
      })
      const prompt = packet.items.length > 0 ? renderPacket(packet) : args.prompt
      const childId = await delegate.start(prompt, args.description, exec.agent, exec.signal)
      return {
        childId,
        providers: [...packet.providers],
        unavailable: [...packet.unavailable],
        truncated: packet.truncated,
      }
    },
  }))
}
