import { describe, expect, it } from 'vitest'
import type { CommandNode, ModelRetryNode, StartedToolCall } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PartialAssistant, RunningToolCall } from '../src/client/contract/snapshot.ts'
import { liveActivity } from '../src/client/chat/live-activity.ts'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

function legacy(input: Parameters<typeof chatSnapshotFixture>[0] = {}) {
  return chatSnapshotFixture(input).legacy
}

function started(name: string, argsRaw: string, time: number, subCalls: StartedToolCall['subCalls'] = []): StartedToolCall {
  return { phase: 'start', callId: `${name}-${time}`, name, argsRaw, args: PartialArguments.fromText(argsRaw), turn: 1, step: 1, time, subCalls }
}

function partial(blocks: PartialAssistant['blocks']): PartialAssistant {
  return { turn: 1, step: 2, blocks }
}

function retryNode(retryState: ModelRetryNode['retryState'], attempt: number): ModelRetryNode {
  return {
    kind: 'model-retry', seq: 5, time: 9_000, retryState, retryId: 'retry-1' as ModelRetryNode['retryId'],
    turn: 1, step: 0, provider: 'mock', mode: 'normal', policyKey: 'mock-normal', retry: attempt, maxRetries: 3,
    delayMs: 2_000, failure: { code: 'TRANSPORT', message: '连接被重置' },
  }
}

function compactNode(outcome: CommandNode['outcome']): CommandNode {
  return { kind: 'command', seq: 6, time: 7_000, commandId: 'cmd-1' as CommandNode['commandId'], name: 'compact', args: '', outcome }
}

describe('liveActivity', () => {
  it('is idle when nothing is in flight', () => {
    expect(liveActivity(legacy())).toEqual({ kind: 'idle' })
  })

  it('reads a running tool by its process and start time', () => {
    expect(liveActivity(legacy({ runningCalls: [started('bash', '{"command":"ls"}', 2_000)] })))
      .toEqual({ kind: 'tool', process: 'commands', detail: 'ls', since: 2_000 })
  })

  it('shows a preparing tool with its name as the detail', () => {
    const preparing: RunningToolCall = { phase: 'preparing', callId: 'p1', name: 'custom_probe', args: PartialArguments.EMPTY, turn: 1, step: 1, time: 3_000, subCalls: [] }
    expect(liveActivity(legacy({ runningCalls: [preparing] })))
      .toEqual({ kind: 'tool', process: 'tools', detail: 'custom_probe', since: 3_000 })
  })

  it('names a background job read and whether it waits', () => {
    expect(liveActivity(legacy({ runningCalls: [started('job_output', '{"job_id":"job_9","wait":true}', 2_000)] })))
      .toEqual({ kind: 'job', jobId: 'job_9', waiting: true, since: 2_000 })
    expect(liveActivity(legacy({ runningCalls: [started('job_output', '{"job_id":"job_9"}', 2_000)] })))
      .toEqual({ kind: 'job', jobId: 'job_9', waiting: false, since: 2_000 })
  })

  it('falls back to a tool row when a job read names no job', () => {
    expect(liveActivity(legacy({ runningCalls: [started('job_output', '{}', 2_000)] })).kind).toBe('tool')
  })

  it('follows the most recent running call into its nested subcalls', () => {
    const child = started('read', '{"path":"src/a.ts"}', 3_000)
    const parent = started('bash', '{"command":"ls"}', 1_000, [child])
    expect(liveActivity(legacy({ runningCalls: [parent] }))).toMatchObject({ kind: 'tool', process: 'read', since: 3_000 })
  })

  it('prefers a running tool over streamed output', () => {
    expect(liveActivity(legacy({
      runningCalls: [started('read', '{"path":"a.ts"}', 2_000)],
      partial: partial([{ kind: 'text', text: 'hello' }]),
    }))).toMatchObject({ kind: 'tool', process: 'read' })
  })

  it('ranks a running tool over streamed output over a scheduled retry over compaction', () => {
    const nodes = [compactNode(null), retryNode('scheduled', 2)]
    expect(liveActivity(legacy({ nodes, partial: partial([]) }))).toMatchObject({ kind: 'generating' })
    expect(liveActivity(legacy({ nodes }))).toMatchObject({ kind: 'retry' })
    expect(liveActivity(legacy({ nodes: [compactNode(null)] }))).toMatchObject({ kind: 'compacting' })
    expect(liveActivity(legacy({ nodes, partial: partial([]), runningCalls: [started('bash', '{"command":"ls"}', 2_000)] })))
      .toMatchObject({ kind: 'tool' })
  })

  it('counts streamed text as tokens and marks the turn as writing', () => {
    expect(liveActivity(legacy({ partial: partial([{ kind: 'text', text: 'a'.repeat(2_400) }]) })))
      .toEqual({ kind: 'generating', key: '1:2', writing: true, tokens: 600 })
  })

  it('rounds reasoning tokens up and keeps the turn thinking', () => {
    expect(liveActivity(legacy({ partial: partial([{ kind: 'reasoning', text: 'b'.repeat(401) }]) })))
      .toEqual({ kind: 'generating', key: '1:2', writing: false, tokens: 101 })
  })

  it('reports generation with no output yet as thinking with zero tokens', () => {
    expect(liveActivity(legacy({ partial: partial([]) })))
      .toEqual({ kind: 'generating', key: '1:2', writing: false, tokens: 0 })
  })

  it('shows a scheduled retry with its attempt and ignores one that started', () => {
    expect(liveActivity(legacy({ nodes: [retryNode('scheduled', 2)] }))).toEqual({ kind: 'retry', attempt: 2, since: 9_000 })
    expect(liveActivity(legacy({ nodes: [retryNode('started', 2)] }))).toEqual({ kind: 'idle' })
  })

  it('shows an unsettled compaction and ignores a settled one', () => {
    expect(liveActivity(legacy({ nodes: [compactNode(null)] }))).toEqual({ kind: 'compacting', since: 7_000 })
    expect(liveActivity(legacy({ nodes: [compactNode({ kind: 'success' })] }))).toEqual({ kind: 'idle' })
  })
})
