/**
 * Request-body shaping for the reasoning level a call asked for.
 * @module dsh-llm-pi-ai/reasoning-payload
 */

import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai'

type Payload = Record<string, unknown>

interface ShapingCompat {
  forceAdaptiveThinking?: boolean
  thinkingFormat?: string
}

const ADAPTIVE_THINKING = { type: 'adaptive', display: 'summarized' }

/**
 * Shape one pi-ai request body for the level that was requested.
 * @param model - the resolved pi-ai model the request is for.
 * @param level - the requested level; `undefined` is the provider default, `off` is reasoning off.
 * @param payload - the body pi-ai built for the call.
 * @returns the body to send.
 */
export function shapeReasoningPayload(
  model: Model<Api>,
  level: ModelThinkingLevel | undefined,
  payload: Payload,
): Payload {
  switch (model.api) {
    case 'anthropic-messages':
      return anthropicPayload(model, level, payload)
    case 'openai-responses':
      return level === undefined ? omit(payload, 'reasoning') : payload
    case 'openai-codex-responses':
      return level === undefined && 'reasoning' in payload ? { ...payload, reasoning: { summary: 'auto' } } : payload
    case 'openai-completions':
      return level === undefined && compatOf(model).thinkingFormat === 'deepseek' ? omit(payload, 'thinking') : payload
    default:
      return payload
  }
}

function anthropicPayload(model: Model<Api>, level: ModelThinkingLevel | undefined, payload: Payload): Payload {
  if (compatOf(model).forceAdaptiveThinking !== true) {
    return level === undefined ? omit(payload, 'thinking') : payload
  }
  if (level === 'off') return payload
  const shaped: Payload = {
    ...payload,
    thinking: isAdaptive(payload.thinking) ? payload.thinking : ADAPTIVE_THINKING,
    messages: withActiveEffort(payload.messages, level),
  }
  // Anthropic: an omitted effort is the model default (medium on Opus and Haiku 5.5, high otherwise).
  return level === undefined ? omit(shaped, 'output_config') : { ...shaped, output_config: { effort: level } }
}

function withActiveEffort(messages: unknown, level: ModelThinkingLevel | undefined): unknown {
  if (!Array.isArray(messages)) return messages
  const list: unknown[] = messages
  const last = list.at(-1)
  if (!isRecord(last) || !('output_config' in last)) return messages
  const rest = list.slice(0, -1)
  return level === undefined ? rest : [...rest, { ...last, output_config: { effort: level } }]
}

function compatOf(model: Model<Api>): ShapingCompat {
  return (model.compat ?? {}) as ShapingCompat
}

function isAdaptive(value: unknown): boolean {
  return isRecord(value) && value.type === 'adaptive'
}

function isRecord(value: unknown): value is Payload {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function omit(payload: Payload, key: string): Payload {
  const { [key]: _removed, ...rest } = payload
  return rest
}
