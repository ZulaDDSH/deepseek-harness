/**
 * Learning write-back: the exact Graphify command line the adapter builds, the
 * order of `save-result` and `reflect`, and the rule that a failed write never
 * publishes a lesson.
 */

import { describe, expect, it } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { assertWritable, explainLesson, firstNodeLabel, parseLessonState, recordLearning } from '../src/graphify-learn.ts'
import type { LearningConfig, LearningWrite } from '../src/graphify-learn.ts'

/** One recorded invocation of the command boundary. */
interface Call {
  readonly command: string
  readonly args: string[]
}

/** A command boundary that records calls and optionally fails the first one. */
function fakeRunner(fail?: (args: readonly string[]) => Error | undefined): {
  readonly runner: NativeCommandRunner
  readonly calls: Call[]
} {
  const calls: Call[] = []
  const runner: NativeCommandRunner = async (command, args) => {
    calls.push({ command, args: [...args] })
    const error = fail?.(args)
    if (error !== undefined) throw error
    return { stdout: 'ok', stderr: '' }
  }
  return { runner, calls }
}

const signal = new AbortController().signal
const config: LearningConfig = { command: 'graphify', memoryDir: '/memory', reflect: true }
const write: LearningWrite = { question: 'Q', answer: 'A', outcome: 'useful', validatedBy: 'reviewer' }

describe('recordLearning', () => {
  it('writes the finding and then reflects on it', async () => {
    const { runner, calls } = fakeRunner()
    const result = await recordLearning(write, config, signal, runner)
    expect(calls).toEqual([
      {
        command: 'graphify',
        args: ['save-result', '--question', 'Q', '--answer', 'A\n\nValidated by: reviewer', '--outcome', 'useful', '--memory-dir', '/memory'],
      },
      { command: 'graphify', args: ['reflect', '--memory-dir', '/memory'] },
    ])
    expect(result).toEqual({ outcome: 'useful', reflected: true, stdout: 'ok' })
  })

  it('skips reflection when the deployment disables it', async () => {
    const { runner, calls } = fakeRunner()
    const result = await recordLearning(write, { ...config, reflect: false }, signal, runner)
    expect(calls).toHaveLength(1)
    expect(result.reflected).toBe(false)
  })

  it('omits the memory directory when none is configured', async () => {
    const { runner, calls } = fakeRunner()
    await recordLearning(write, { command: 'graphify', reflect: true }, signal, runner)
    expect(calls[0]?.args).toEqual(['save-result', '--question', 'Q', '--answer', 'A\n\nValidated by: reviewer', '--outcome', 'useful'])
  })

  it('passes the correction text for a corrected outcome', async () => {
    const { runner, calls } = fakeRunner()
    await recordLearning({ ...write, outcome: 'corrected', correction: 'the real owner' }, config, signal, runner)
    expect(calls[0]?.args).toContain('--correction')
    expect(calls[0]?.args).toContain('the real owner')
  })

  it('cites the nodes a finding is about so Graphify can attach a lesson', async () => {
    const { runner, calls } = fakeRunner()
    await recordLearning({ ...write, nodes: ['closeSession()', 'openSession()'] }, config, signal, runner)
    expect(calls[0]?.args).toContain('--nodes')
    expect(calls[0]?.args).toContain('closeSession()')
    expect(calls[0]?.args).toContain('openSession()')
  })

  it('omits the node citation when the finding names none', async () => {
    const { runner, calls } = fakeRunner()
    await recordLearning(write, config, signal, runner)
    expect(calls[0]?.args).not.toContain('--nodes')
    await recordLearning({ ...write, nodes: [] }, config, signal, runner)
    expect(calls[1]?.args).not.toContain('--nodes')
  })

  it('records a dead end as a dead end rather than as preferred knowledge', async () => {
    const { runner, calls } = fakeRunner()
    const result = await recordLearning({ ...write, outcome: 'dead_end' }, config, signal, runner)
    expect(calls[0]?.args).toContain('dead_end')
    expect(result.outcome).toBe('dead_end')
  })

  it('never reflects after a failed write', async () => {
    const { runner, calls } = fakeRunner(args => args[0] === 'save-result' ? new Error('graphify: no such command') : undefined)
    await expect(recordLearning(write, config, signal, runner)).rejects.toThrow('no such command')
    expect(calls).toHaveLength(1)
  })

  it('reports a saved finding separately from failed reflection', async () => {
    const { runner } = fakeRunner(args => args[0] === 'reflect' ? new Error('reflect failed') : undefined)
    await expect(recordLearning(write, config, signal, runner)).resolves.toMatchObject({ reflected: false, reflectionError: 'Error: reflect failed', outcome: 'useful' })
  })
})

describe('assertWritable', () => {
  it('rejects a corrected outcome with no correction text', () => {
    expect(() => { assertWritable({ ...write, outcome: 'corrected' }) }).toThrow(/requires the correction text/)
    expect(() => { assertWritable({ ...write, outcome: 'corrected', correction: '   ' }) }).toThrow(/requires the correction text/)
  })

  it('accepts a corrected outcome that carries its correction', () => {
    expect(() => { assertWritable({ ...write, outcome: 'corrected', correction: 'X' }) }).not.toThrow()
  })

  it('runs before any command is spent', async () => {
    const { runner, calls } = fakeRunner()
    await expect(recordLearning({ ...write, outcome: 'corrected' }, config, signal, runner)).rejects.toThrow()
    expect(calls).toEqual([])
  })
})

describe('parseLessonState', () => {
  it('reads the status and the reverification marker Graphify prints', () => {
    const text = 'Node: closeSession()\n'
      + '  ID:        session_closesession\n'
      + '  Lesson: preferred source (start here) — 2 useful, score=1.99 [code changed since — re-verify]\n'
    expect(parseLessonState('closeSession()', text)).toEqual({
      node: 'closeSession()',
      status: 'preferred',
      stale: true,
    })
  })

  it('reports a current lesson when no reverification marker is present', () => {
    const text = '  Lesson: preferred source (start here) — 2 useful, score=1.99999835\n'
    expect(parseLessonState('closeSession()', text)).toMatchObject({ status: 'preferred', stale: false })
  })

  it('reports nothing when the node carries no lesson', () => {
    expect(parseLessonState('openSession()', 'Node: openSession()\n  Degree: 1\n')).toBeUndefined()
  })

  it('treats a lesson line without a status as present but unknown', () => {
    expect(parseLessonState('openSession()', 'Lesson:\n')).toEqual({ node: 'openSession()', stale: false })
  })
})

describe('firstNodeLabel', () => {
  it('reads the seed node from rendered graph output', () => {
    const text = 'Traversal: BFS depth=2 | 2 nodes found\n\n'
      + 'NODE closeSession() [src=session.ts loc=L1 community=session.ts]\n'
      + 'NODE openSession() [src=session.ts loc=L9 community=openSession]\n'
    expect(firstNodeLabel(text)).toBe('closeSession()')
  })

  it('reports nothing for output that lists no node', () => {
    expect(firstNodeLabel('No matching nodes found.')).toBeUndefined()
  })
})

describe('explainLesson', () => {
  it('keeps custom-memory freshness unknown without probing the default store', async () => {
    const { runner, calls } = fakeRunner()
    expect(await explainLesson('closeSession()', config, signal, runner)).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('asks Graphify to explain exactly the node it was given', async () => {
    const { runner, calls } = fakeRunner()
    const state = await explainLesson('closeSession()', { command: config.command, reflect: config.reflect }, signal, runner)
    expect(calls).toEqual([{ command: 'graphify', args: ['explain', 'closeSession()'] }])
    expect(state).toBeUndefined()
  })
})
