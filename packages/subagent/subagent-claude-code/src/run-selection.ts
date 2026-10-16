/**
 * Per-run model and effort for one Claude Code child, validated against the Claude Code model list.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code/run-selection
 */

import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'

const MODEL_ALIASES: readonly string[] = ['sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan']
const MODEL_ID = /^claude-(?:opus|sonnet|haiku|fable)-\d+(?:-\d+)?(?:-\d{8})?$/
const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Model and effort that one child run sets when its start request names them. */
export interface ClaudeRunSelection {
  readonly model?: string
  readonly effort?: EffortLevel
}

/**
 * Validate the per-run agent options of one Claude Code child start request.
 * @param options - the request's agent options; only `model` and `reasoningEffort` apply to a Claude Code run.
 * @returns the model and effort the run sets, or an empty selection when neither is named.
 */
export function claudeRunSelectionOf(options: AgentOptions | undefined): ClaudeRunSelection {
  if (options === undefined) return {}
  if (options.provider !== undefined || options.maxTokens !== undefined) {
    throw new Error('subagent-claude-code: a child run may set only model and reasoningEffort')
  }
  const model = options.model
  if (model !== undefined && !MODEL_ALIASES.includes(model) && !MODEL_ID.test(model)) {
    throw new Error(`subagent-claude-code: "${model}" is not a Claude Code model alias or id`)
  }
  const effortText: string | undefined = options.reasoningEffort
  const effort = effortText === undefined ? undefined : EFFORT_LEVELS.find(level => level === effortText)
  if (effortText !== undefined && effort === undefined) {
    throw new Error(`subagent-claude-code: reasoning effort "${effortText}" is not a Claude Code effort level`)
  }
  return {
    ...model === undefined ? {} : { model },
    ...effort === undefined ? {} : { effort },
  }
}
