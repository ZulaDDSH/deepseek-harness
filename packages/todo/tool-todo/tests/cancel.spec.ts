import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as ToolTodo from '../src/index.ts'
import { cancelTodos } from '../src/cancel.ts'
import type { TodoItem } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const todos: TodoItem[] = [{ content: 'Done', status: 'completed' }, { content: 'Build', status: 'in_progress' }, { content: 'Test', status: 'pending' }]

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  const register = vi.fn()
  ctx.provide('commands', { register } as never)
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  const session = Session.create(SessionId('cancel-todos'))
  session.append('todo/write', { todos })
  const inject = vi.fn()
  const cancel = vi.fn()
  const agent = { session, inject, cancel } as unknown as Agent
  const invocation = (content: string | null, expected = todos): CommandInvocation => ({
    agent, commandId: 'cancel' as CommandInvocation['commandId'], attachments: [],
    signal: new AbortController().signal,
    rawInput: JSON.stringify({ content, expected: JSON.stringify(expected.map(item => [item.content, item.status])) }),
  })
  return { ctx, session, inject, cancel, invocation, register }
}

describe('to-do cancellation', () => {
  it('removes only the chosen unfinished task and injects user intent without starting a turn', async () => {
    const h = await setup()
    expect(h.register).toHaveBeenCalledWith(expect.objectContaining({ name: 'cancel-todos' }))
    expect(cancelTodos(h.ctx, h.invocation('Build')).kind).toBe('success')
    expect(h.ctx.sessionProjections.stateOf(h.session, 'todos')).toEqual([todos[0], todos[2]])
    expect(h.cancel).not.toHaveBeenCalled()
    expect(h.inject).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: 'user' }, content: [expect.objectContaining({ text: expect.stringContaining('Do not continue or re-add') })] }))
  })

  it('cancels all unfinished tasks and stops the run while retaining completed tasks and the inbox', async () => {
    const h = await setup()
    expect(cancelTodos(h.ctx, h.invocation(null)).kind).toBe('success')
    expect(h.ctx.sessionProjections.stateOf(h.session, 'todos')).toEqual([todos[0]])
    expect(h.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
  })

  it('rejects stale, completed, malformed and aborted selections without changing the plan', async () => {
    const h = await setup()
    for (const request of [h.invocation('Build', []), h.invocation('Done'), { ...h.invocation(null), rawInput: '{}' }]) {
      expect(cancelTodos(h.ctx, request).kind).toBe('error')
    }
    const abort = new AbortController()
    abort.abort()
    expect(() => cancelTodos(h.ctx, { ...h.invocation(null), signal: abort.signal })).toThrow()
    expect(h.ctx.sessionProjections.stateOf(h.session, 'todos')).toEqual(todos)
    expect(h.inject).not.toHaveBeenCalled()
    expect(h.cancel).not.toHaveBeenCalled()
  })
})
