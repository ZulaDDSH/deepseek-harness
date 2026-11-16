import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import type { TodoItem } from './types.ts'

const selection = z.object({ expected: z.string(), content: z.string().nullable() })

/**
 * Remove one unfinished to-do, or every unfinished to-do and stop the turn when the selection content is null.
 * Rejects the request when the list no longer matches the expected snapshot.
 * @param ctx - plugin context that owns the session.
 * @param invocation - command invocation whose raw input is the JSON selection.
 * @returns the command result, or an error for an invalid or stale selection.
 */
export function cancelTodos(ctx: Context, invocation: CommandInvocation): CommandResult {
  let request: z.infer<typeof selection>
  try {
    request = selection.parse(JSON.parse(invocation.rawInput))
  } catch {
    return { kind: 'error', text: 'Invalid to-do cancellation selection.' }
  }
  invocation.signal.throwIfAborted()
  const { agent } = invocation
  const current: TodoItem[] = ctx.sessionProjections.snapshot(agent.session, ['todos']).values.todos ?? []
  if (request.expected !== JSON.stringify(current.map(item => [item.content, item.status]))) {
    return { kind: 'error', text: 'The to-do list changed. Review the current list and try again.' }
  }
  const cancelled = current.filter(item => item.status !== 'completed'
    && (request.content === null || item.content === request.content))
  if (cancelled.length === 0) return { kind: 'error', text: 'That to-do is no longer pending or in progress.' }
  const removed = new Set(cancelled)
  const todos: TodoItem[] = current.filter(item => !removed.has(item))
  const event = agent.session.append('todo/write', { todos })
  agent.inject(createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: `I cancelled these to-dos: ${JSON.stringify(cancelled.map(item => item.content))}. Do not continue or re-add them unless I ask.${request.content === null ? ' Stop work on this plan.' : ' Continue any other remaining work.'}` }],
  }))
  if (request.content === null) agent.cancel({ kind: 'user' }, { keepInbox: true })
  return { kind: 'success', text: `Cancelled ${cancelled.length} to-do(s).`, sourceEventSeq: event.seq }
}
