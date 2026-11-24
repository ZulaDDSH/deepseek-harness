import { describe, expect, it } from 'vitest'
import { deliverablesDefinition } from '../src/client/turn-deliverables.ts'

type Update = NonNullable<typeof deliverablesDefinition.update>

function trackedPath(name: string, args: Record<string, unknown>): string | null | undefined {
  const state = { turn: 1, calls: new Map<string, string | null>(), produced: [] }
  const match = { id: '1', role: 'update', event: { type: 'tool/call', seq: 1, time: 1, data: { turn: 1, step: 1, callId: 'c1', name, arguments: JSON.stringify(args) } } }
  const next = (deliverablesDefinition.update as Update)({ state } as never, match as never) as typeof state
  return next.calls.get('c1')
}

describe('edit append tracking', () => {
  it.each([
    { caseName: 'an append with an empty old_string', args: { file_path: 'notes.md', old_string: '', new_string: 'tail\n', append: true }, tracked: 'notes.md' },
    { caseName: 'an append with new_string only', args: { file_path: 'notes.md', new_string: 'tail\n', append: true }, tracked: 'notes.md' },
    { caseName: 'an append with an empty new_string', args: { file_path: 'notes.md', old_string: '', new_string: '', append: true }, tracked: null },
    { caseName: 'an append naming an old_string', args: { file_path: 'notes.md', old_string: 'x', new_string: 'y', append: true }, tracked: null },
    { caseName: 'an append with replace_all', args: { file_path: 'notes.md', old_string: '', new_string: 'y', append: true, replace_all: true }, tracked: null },
    { caseName: 'an empty old_string without append', args: { file_path: 'notes.md', old_string: '', new_string: 'y' }, tracked: null },
    { caseName: 'a replacement', args: { file_path: 'notes.md', old_string: 'a', new_string: 'b' }, tracked: 'notes.md' },
  ])('tracks $caseName as $tracked', ({ args, tracked }) => {
    expect(trackedPath('edit', args)).toBe(tracked)
  })
})
