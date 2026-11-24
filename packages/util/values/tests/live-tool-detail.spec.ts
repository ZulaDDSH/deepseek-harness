import { describe, expect, it, vi } from 'vitest'
import { liveToolDetail, normalizeLiveToolDetail } from '../src/index.ts'

describe('liveToolDetail', () => {
  it('takes the earliest recognised key in the shared order and skips empty values', () => {
    expect(liveToolDetail('bash', JSON.stringify({ command: 'ls', description: 'List files' }))).toBe('List files')
    expect(liveToolDetail('grep', '{"path":"src","command":"rg x"}')).toBe('rg x')
    expect(liveToolDetail('bash', '{"command":"  ","path":"a.ts"}')).toBe('a.ts')
  })

  it('flattens whitespace and joins string arrays', () => {
    expect(liveToolDetail('bash', JSON.stringify({ command: 'git  diff\n\t--cached ' }))).toBe('git diff --cached')
    expect(liveToolDetail('web_search', '{"queries":["a  b","c"]}')).toBe('a b, c')
  })

  it('bounds the detail to 160 graphemes, ending in an ellipsis when cut', () => {
    expect(liveToolDetail('read', JSON.stringify({ path: 'a'.repeat(160) }))).toBe('a'.repeat(160))
    expect(liveToolDetail('read', JSON.stringify({ path: 'a'.repeat(161) }))).toBe(`${'a'.repeat(159)}…`)
    expect(liveToolDetail('read', JSON.stringify({ path: '👍'.repeat(161) }))).toBe(`${'👍'.repeat(159)}…`)
    expect(liveToolDetail('read', JSON.stringify({ path: `${'a'.repeat(158)} ${'b'.repeat(50)}` }))).toBe(`${'a'.repeat(158)}…`)
  })

  it('reads questions from the first object that carries a question', () => {
    expect(liveToolDetail('ask_user_question', JSON.stringify({ questions: [null, 3, { question: '  Which  branch? ' }] })))
      .toBe('Which branch?')
    expect(liveToolDetail('ask_user_question', '{"questions":[{"header":"x"}]}')).toBe('ask_user_question')
  })

  it('falls back to the tool name when the arguments have no safe detail', () => {
    expect(liveToolDetail('bash', '{"command":')).toBe('bash')
    expect(liveToolDetail('bash', '"text"')).toBe('bash')
    expect(liveToolDetail('bash', 'null')).toBe('bash')
    expect(liveToolDetail('bash', '{"queries":["a",1]}')).toBe('bash')
    expect(liveToolDetail('todo_write', '{"items":[]}')).toBe('todo_write')
  })
})

describe('normalizeLiveToolDetail', () => {
  it('yields empty text for a value without text', () => {
    expect(normalizeLiveToolDetail(undefined)).toBe('')
  })

  it('segments only a bounded prefix of a huge text and still truncates with an ellipsis', () => {
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      const detail = normalizeLiveToolDetail(`${'word  \n '.repeat(500_000)}end`)
      expect(detail).toHaveLength(160)
      expect(detail.endsWith('…')).toBe(true)
      expect(detail.startsWith('word word word')).toBe(true)
      const segmented = segment.mock.calls.map(([input]) => input.length)
      expect(Math.max(...segmented)).toBeLessThanOrEqual(1100)
    } finally {
      segment.mockRestore()
    }
  })

  it('keeps supplementary-plane graphemes whole at the cut and short text exact', () => {
    expect(normalizeLiveToolDetail(`  a \t b\n${'😀'.repeat(2000)}`)).toBe(`a b ${'😀'.repeat(155)}…`)
    expect(normalizeLiveToolDetail('  a \n b  ')).toBe('a b')
  })
})

describe('liveToolDetail memo', () => {
  it('parses an unchanged streamed argument once', () => {
    const parse = vi.spyOn(JSON, 'parse')
    try {
      const raw = JSON.stringify({ command: 'x'.repeat(50_000) })
      liveToolDetail('bash', raw)
      liveToolDetail('bash', raw)
      expect(parse).toHaveBeenCalledTimes(1)
      expect(liveToolDetail('other', raw)).toBe(liveToolDetail('other', raw))
      expect(parse).toHaveBeenCalledTimes(2)
    } finally {
      parse.mockRestore()
    }
  })
})
