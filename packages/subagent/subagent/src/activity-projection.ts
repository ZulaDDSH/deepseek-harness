/**
 * Session projection of a subagent's live tool activity for catalog rows.
 *
 * @module @deepseek-ai/dsh-subagent/activity-projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SubagentActivityProjection, SubagentToolActivity } from './projection-types.ts'

const MAX_TEXT = 120
const MAX_RUNNING = 8
const DETAIL_KEYS = [
  'command', 'cmd', 'pattern', 'query', 'queries', 'url', 'file_path', 'path', 'description', 'task', 'prompt', 'name',
] as const

function oneLine(value: unknown): string {
  const text = typeof value === 'string' ? value
    : Array.isArray(value) && value.every(item => typeof item === 'string') ? value.join(', ') : ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= MAX_TEXT ? flat : `${flat.slice(0, MAX_TEXT - 1).trimEnd()}…`
}

/**
 * Pick the argument that says what a tool call is doing.
 * @param args - raw JSON arguments of the call.
 * @returns the first recognised command, path, pattern, or URL on one line; empty when none applies.
 */
export function describeToolCall(args: string): string {
  try {
    const parsed: unknown = JSON.parse(args)
    if (parsed === null || typeof parsed !== 'object') return ''
    for (const key of DETAIL_KEYS) {
      const detail = oneLine(Reflect.get(parsed, key))
      if (detail !== '') return detail
    }
  } catch {
    // Streamed or free-form arguments have no safe one-line description.
  }
  return ''
}

interface ActivityState {
  steps: number
  running: SubagentToolActivity[]
  last?: SubagentActivityProjection['last'] | undefined
}

const toolSchema = z.object({
  callId: z.string(),
  name: z.string(),
  detail: z.string(),
  since: z.number().int().nonnegative(),
}).strict()

const lastSchema = z.object({
  name: z.string(),
  detail: z.string(),
  isError: z.boolean(),
  summary: z.string(),
  time: z.number().int().nonnegative(),
}).strict()

const stateSchema: z.ZodType<ActivityState> = z.object({
  steps: z.number().int().nonnegative(),
  running: z.array(toolSchema),
  last: lastSchema.optional(),
}).strict()

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    subagentActivity: ActivityState
  }
}

/**
 * Fold step count, tool calls still awaiting a result, and the latest finished call.
 * Turn boundaries reset it so a closed child shows no stale running tool.
 */
export const subagentActivityProjectionDefinition = {
  key: 'subagentActivity',
  stateSchema,
  init: (): ActivityState => ({ steps: 0, running: [] }),
  apply: (state, event) => {
    switch (event.type) {
      case 'turn/start':
        return { steps: 0, running: [] }
      case 'turn/end':
        return { steps: state.steps, running: [], ...state.last === undefined ? {} : { last: state.last } }
      case 'step/start':
        return { ...state, steps: state.steps + 1 }
      case 'tool/call': {
        const call = {
          callId: event.data.callId, name: event.data.name,
          detail: describeToolCall(event.data.arguments), since: event.time,
        }
        return { ...state, running: [...state.running, call].slice(-MAX_RUNNING) }
      }
      case 'tool/result': {
        const callId = event.data.message.toolCallId
        const call = state.running.find(item => item.callId === callId)
        if (call === undefined) return state
        const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(' ')
        return {
          ...state,
          running: state.running.filter(item => item !== call),
          last: {
            name: call.name, detail: call.detail, isError: event.data.message.isError === true,
            summary: oneLine(text), time: event.time,
          },
        }
      }
      default:
        return state
    }
  },
  wire: {
    viewSchema: z.object({
      steps: z.number().int().nonnegative(),
      running: toolSchema.optional(),
      last: lastSchema.optional(),
    }).strict() as z.ZodType<SubagentActivityProjection>,
    view: (state): SubagentActivityProjection => {
      const running = state.running.at(-1)
      return {
        steps: state.steps,
        ...running === undefined ? {} : { running },
        ...state.last === undefined ? {} : { last: state.last },
      }
    },
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'subagentActivity', ActivityState>
