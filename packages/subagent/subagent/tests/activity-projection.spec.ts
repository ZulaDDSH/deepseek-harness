import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describeToolCall, subagentActivityProjectionDefinition } from '../src/activity-projection.ts'

function ev(type: SessionEvent['type'], time: number, data: object): SessionEvent {
  return { type, seq: time, time, data } as SessionEvent
}

const call = (id: string, name: string, args: object, time: number): SessionEvent =>
  ev('tool/call', time, { turn: 1, step: 1, callId: id, name, arguments: JSON.stringify(args) })

const result = (id: string, text: string, time: number, isError = false): SessionEvent =>
  ev('tool/result', time, { turn: 1, step: 1, message: { role: 'tool', toolCallId: id, isError, content: [{ type: 'text', text }] } })

function fold(events: SessionEvent[]) {
  const definition = subagentActivityProjectionDefinition
  let state = definition.init()
  for (const item of events) state = definition.apply(state, item)
  return definition.wire.view(state)
}

describe('subagent activity projection', () => {
  it('names the key argument of a call, or the tool when no argument says what it does', () => {
    expect(describeToolCall('bash', JSON.stringify({ command: 'git  diff\n--cached', timeout: 5 }))).toBe('git diff --cached')
    expect(describeToolCall('grep', '{"pattern":"TODO","path":"src"}')).toBe('TODO')
    expect(describeToolCall('bash', 'not json')).toBe('bash')
    expect(describeToolCall('todo_write', '{"items":[]}')).toBe('todo_write')
  })

  it('shows the running call, then the finished call with a result summary and the step count', () => {
    const open = [
      ev('turn/start', 1, { turn: 1 }), ev('step/start', 2, { turn: 1, step: 1 }),
      call('a', 'bash', { command: 'git diff 0533a03c' }, 3),
    ]
    expect(fold(open)).toEqual({
      steps: 1, running: { callId: 'a', name: 'bash', detail: 'git diff 0533a03c', since: 3 },
    })
    expect(fold([...open, result('a', 'diff --git a/x b/x\n+one', 9)])).toEqual({
      steps: 1,
      last: { name: 'bash', detail: 'git diff 0533a03c', isError: false, summary: 'diff --git a/x b/x +one', time: 9 },
    })
  })

  it('reports failures, drops unmatched results, and clears running calls at turn end', () => {
    const events = [
      ev('turn/start', 1, { turn: 1 }), call('a', 'read', { file_path: 'a.cs' }, 2), call('b', 'grep', { pattern: 'x' }, 3),
      result('zzz', 'orphan', 4), result('a', 'ENOENT', 5, true),
    ]
    expect(fold(events)).toMatchObject({
      running: { callId: 'b' }, last: { name: 'read', isError: true, summary: 'ENOENT' },
    })
    expect(fold([...events, ev('turn/end', 6, { turn: 1, reason: { kind: 'aborted' } })]).running).toBeUndefined()
    expect(fold([...events, ev('turn/start', 7, { turn: 2 })])).toEqual({ steps: 0 })
  })
})
