/** @module @deepseek-ai/dsh-knowledge-router/tool-learn */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { LearningResult, LearningWrite } from './graphify-learn.ts'

/** What the tool needs from the router that owns it. */
export interface KnowledgeLearnTarget {
  /**
   * Write one validated finding and report what the write did.
   * @param write - the validated finding and its source references.
   * @param signal - caller cancellation.
   * @param agent - the calling agent, whose authority decides whether the write is allowed.
   * @returns the written outcome and whether reflection ran.
   */
  learn(write: LearningWrite, signal: AbortSignal, agent?: Agent): Promise<LearningResult>
}

const DESCRIPTION = 'Record a validated finding as persistent learned knowledge. '
  + 'Use this only after a finding has been verified against current repository source, runtime evidence, or test results; never to record an unverified guess or a worker\'s own unsupported answer. '
  + 'The finding is written to the configured learned-knowledge provider, which then decides how it is scored, corroborated, superseded, and marked stale. '
  + 'A `corrected` outcome must carry the correction that supersedes the earlier answer.'

/**
 * Register the learning write-back tool on the calling context.
 * @param ctx - context whose `tools` registry receives the definition.
 * @param target - the router that performs the write.
 */
export function registerKnowledgeLearnTool(ctx: Context, target: KnowledgeLearnTarget): void {
  ctx.tools.register(defineTool({
    name: 'knowledge_record',
    description: DESCRIPTION,
    parameters: {
      question: {
        type: 'string',
        required: true,
        description: 'The question the validated finding answers.',
      },
      answer: {
        type: 'string',
        required: true,
        description: 'The validated answer, stated as the durable conclusion rather than the investigation that produced it.',
      },
      outcome: {
        type: 'string',
        required: true,
        enum: ['useful', 'dead_end', 'corrected'],
        description: 'How the finding was classified: `useful` confirmed an approach, `dead_end` rules one out, `corrected` supersedes an earlier answer.',
      },
      correction: {
        type: 'string',
        description: 'The correction that supersedes an earlier answer. Required when the outcome is `corrected`.',
      },
      nodes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Node labels this finding is about, so the provider can attach the outcome to them. A finding that cites no node is recorded but never becomes a retrievable lesson.',
      },
      validated_by: {
        type: 'string',
        required: true,
        description: 'The agent or model that verified this finding, recorded so later readers can weigh its source references.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outcome: { type: 'string', required: true, enum: ['useful', 'dead_end', 'corrected'] },
          reflected: { type: 'boolean', required: true },
          stdout: { type: 'string', required: true },
          reflectionError: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const head = `recorded a ${value.outcome} finding; reflection ${value.reflected ? 'ran' : 'skipped'}`
        return [{ type: 'text', text: value.reflectionError !== undefined ? head + '; reflection failed: ' + value.reflectionError : value.stdout.trim() === '' ? head : `${head}\n${value.stdout.trim()}` }]
      },
    },
    async execute(args, exec) {
      return target.learn({
        question: args.question,
        answer: args.answer,
        outcome: args.outcome,
        ...args.correction !== undefined ? { correction: args.correction } : {},
        ...args.nodes !== undefined ? { nodes: args.nodes } : {},
        validatedBy: args.validated_by,
      }, exec.signal, exec.agent)
    },
  }))
}
