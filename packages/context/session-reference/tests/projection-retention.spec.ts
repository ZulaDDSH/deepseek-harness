import { afterEach, describe, expect, it, vi } from 'vitest'
import { retainReferencedSession } from '../src/projection.ts'

afterEach(() => { vi.restoreAllMocks() })

function snapshot(count: number, size: number) {
  const events = Array.from({ length: count }, (_, index) => ({
    type: 'user/message',
    seq: index,
    time: 0,
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: `${String(index).padStart(5, '0')}${'x'.repeat(size)}` }] },
  }))
  return { session: { id: 'ref', cwd: null }, capturedThroughSeq: count - 1, events } as never
}

describe('retainReferencedSession omission', () => {
  it('keeps the newest messages within the byte cap', () => {
    const result = retainReferencedSession(snapshot(40, 100), 'label', 1500)
    if (result === undefined) throw new Error('expected a retained preview')
    expect(Buffer.byteLength(JSON.stringify(result.data), 'utf8')).toBeLessThanOrEqual(1500)
    const texts = result.data.conversation.map(item => item.text)
    expect(texts.at(-1)?.startsWith('00039')).toBe(true)
    expect(result.stats.omittedMessages + result.stats.retainedMessages).toBe(40)
    expect(texts[0]?.startsWith('000')).toBe(true)
  })

  it('serializes a long transcript a bounded number of times while omitting most of it', () => {
    const source = snapshot(3000, 300)
    const stringify = vi.spyOn(JSON, 'stringify')
    const result = retainReferencedSession(source, 'label', 5000)
    const serialized = stringify.mock.results.reduce((sum, call) => sum + (typeof call.value === 'string' ? call.value.length : 0), 0)
    expect(result?.stats.omittedMessages).toBeGreaterThan(2900)
    expect(serialized).toBeLessThan(3000 * 310 * 10)
  })
})
