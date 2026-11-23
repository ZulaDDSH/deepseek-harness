/** Explicit blockquote recognition and decoding for quote presentation. */

/**
 * Remove one blockquote marker from each explicitly quoted line.
 * @param text - consecutive blockquote lines, with up to three leading spaces.
 * @returns excerpt text with original line endings normalized.
 */
export function quoteTextOf(text: string): string {
  return text.replace(/\r\n?/gu, '\n').replace(/^ {0,3}>[ \t]?/gmu, '')
}

/** One blockquote span in original UTF-16 text, excluding its trailing line break. */
export interface MessageQuoteRange {
  readonly start: number
  readonly end: number
}

function fencedSpans(text: string): readonly MessageQuoteRange[] {
  const spans: MessageQuoteRange[] = []
  let open: { start: number; marker: string; length: number } | undefined
  for (const line of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)) {
    const content = line[0].replace(/[\r\n]+$/u, '')
    if (open === undefined) {
      const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(content)
      if (fence !== null && !(fence[1]![0] === '`' && fence[2]!.includes('`'))) open = { start: line.index, marker: fence[1]![0]!, length: fence[1]!.length }
    } else {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(content)
      if (close !== null && close[1]![0] === open.marker && close[1]!.length >= open.length) {
        spans.push({ start: open.start, end: line.index + line[0].length })
        open = undefined
      }
    }
  }
  if (open !== undefined) spans.push({ start: open.start, end: text.length })
  return spans
}

/**
 * Recognize consecutive explicitly marked Markdown blockquote lines.
 * @param text - complete original message text.
 * @returns ordered nonblank quote spans; inline greater-than signs remain ordinary text.
 */
export function messageQuoteRanges(text: string): readonly MessageQuoteRange[] {
  const ranges: MessageQuoteRange[] = []
  const fences = fencedSpans(text)
  for (const match of text.matchAll(/^ {0,3}>[^\r\n]*(?:\r?\n {0,3}>[^\r\n]*)*/gmu)) {
    if (fences.some(fence => match.index >= fence.start && match.index < fence.end)) continue
    if (quoteTextOf(match[0]).trim() !== '') ranges.push({ start: match.index, end: match.index + match[0].length })
  }
  return ranges
}
