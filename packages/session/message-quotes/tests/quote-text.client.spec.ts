/** Quote decoding and source offsets. */
import { describe, expect, it } from 'vitest'
import { messageQuoteRanges, quoteTextOf } from '../src/client/quote-text.ts'

describe('message blockquotes', () => {
  it('normalizes line endings and decodes one quote level', () => {
    expect(quoteTextOf('> first\r\n  > > nested\n>third')).toBe('first\n> nested\nthird')
  })

  it('recognizes consecutive explicit quote lines and preserves original offsets', () => {
    const text = 'before\n\n> first\n> line\n\n> second\n\nafter'
    expect(messageQuoteRanges(text)).toEqual([{ start: 8, end: 22 }, { start: 24, end: 32 }])
    expect(messageQuoteRanges('  > first\r\n>second')).toEqual([{ start: 0, end: 18 }])
  })

  it('leaves quote-looking lines inside fenced code as literal text', () => {
    expect(messageQuoteRanges('```\n> result\n```')).toEqual([])
    expect(messageQuoteRanges('~~~sh\n$ run\n> result\n~~~\n> real')).toEqual([{ start: 25, end: 31 }])
    expect(messageQuoteRanges('```\r\n> a\r\n```\r\n> b')).toEqual([{ start: 15, end: 18 }])
  })

  it('handles nested, mismatched and unmatched fences', () => {
    expect(messageQuoteRanges('````\n```\n> inner\n```\n````\n> out')).toEqual([{ start: 26, end: 31 }])
    expect(messageQuoteRanges('```\n> a\n~~~\n> b\n```\n> c')).toEqual([{ start: 20, end: 23 }])
    expect(messageQuoteRanges('```\n> never closed')).toEqual([])
    expect(messageQuoteRanges('> before\n```\n> inside')).toEqual([{ start: 0, end: 8 }])
    expect(messageQuoteRanges('``` a`b\n> quote')).toEqual([{ start: 8, end: 15 }])
    expect(messageQuoteRanges('    ```\n> quote')).toEqual([{ start: 8, end: 15 }])
  })

  it('leaves comparisons, indented code and blank excerpts as ordinary text', () => {
    expect(messageQuoteRanges('a > b\n    > code\n> \n>')).toEqual([])
    expect(messageQuoteRanges('')).toEqual([])
  })
})
