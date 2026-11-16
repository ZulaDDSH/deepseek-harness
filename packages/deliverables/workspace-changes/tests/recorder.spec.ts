import { describe, expect, it } from 'vitest'
import { servedRecordOf } from '../src/recorder.ts'
import { isStoredRecord, STORE_VERSION, type StoredRecord } from '../src/store.ts'

function record(over: Partial<StoredRecord> = {}): StoredRecord {
  return {
    version: STORE_VERSION,
    summary: {
      turn: 1,
      cwd: '/workspace',
      files: [{ path: 'a.txt', display: 'a.txt', added: 1, deleted: 0 }],
      total: 1,
      added: 1,
      deleted: 0,
    },
    sources: [{ before: { kind: 'absent' }, after: { kind: 'absent' } }],
    ...over,
  }
}

describe('durable turn records', () => {
  it('refuses a stored comparison when either optional side is missing', () => {
    const sources: StoredRecord['sources'][] = [
      [{ after: { kind: 'absent' } }],
      [{ before: { kind: 'absent' } }],
      [{}],
    ]

    for (const source of sources) {
      const stored = record({ sources: source })
      expect(isStoredRecord(stored)).toBe(true)
      expect(servedRecordOf(stored, '/session', null)).toBeUndefined()
    }
  })

  it('refuses a stored snapshot comparison when its repository is unavailable', () => {
    const stored = record({
      sources: [{
        before: { kind: 'snapshot', tree: 'tree-before', path: 'a.txt' },
        after: { kind: 'absent' },
      }],
    })

    expect(isStoredRecord(stored)).toBe(true)
    expect(servedRecordOf(stored, '/session', null)).toBeUndefined()
  })
})
