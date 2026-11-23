/**
 * Pure text updates following OpenAI Codex rust-v0.158.0 NormalizeToLf behavior.
 * Adapted from seek_sequence.rs and file_update.rs with structured match failures.
 * Copyright 2025 OpenAI. Apache-2.0 portions and modification notice: ../LICENSE.
 */

import type { ApplyHunksResult, HunkApplyFailure, PatchHunk } from './types.ts'

const WHITE_SPACE = /\p{White_Space}/u

function trimWhitespace(value: string, leading: boolean): string {
  let start = 0
  let end = value.length
  if (leading) {
    while (start < end && WHITE_SPACE.test(value.charAt(start))) start++
  }
  while (end > start && WHITE_SPACE.test(value.charAt(end - 1))) end--
  return value.slice(start, end)
}

function normalizePunctuation(value: string): string {
  return trimWhitespace(value, true)
    .replace(/[\u2010-\u2015\u2212]/gu, '-')
    .replace(/[\u2018-\u201B]/gu, "'")
    .replace(/[\u201C-\u201F]/gu, '"')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/gu, ' ')
}

const MAX_MATCH_COMPARISONS = 10_000_000

class MatchBudgetExceeded extends Error {}

interface Matcher {
  lines: readonly string[]
  passes: (readonly string[] | undefined)[]
  remaining: number
}

const MATCH_PASSES = [
  (value: string) => value,
  (value: string) => trimWhitespace(value, false),
  (value: string) => trimWhitespace(value, true),
  normalizePunctuation,
]

/** NormalizeToLf checks only the tail candidate for EOF, even before the cursor. */
function seekSequence(matcher: Matcher, pattern: readonly string[], start: number, eof: boolean): number | undefined {
  const { lines } = matcher
  if (pattern.length === 0) return start
  if (pattern.length > lines.length) return undefined
  const last = lines.length - pattern.length
  const first = eof ? last : start
  for (const [pass, normalize] of MATCH_PASSES.entries()) {
    const haystack = pass === 0 ? lines : matcher.passes[pass] ??= lines.map(normalize)
    const expected = pattern.map(normalize)
    for (let index = first; index <= last; index++) {
      let offset = 0
      while (offset < expected.length) {
        if (--matcher.remaining < 0) throw new MatchBudgetExceeded()
        if (haystack[index + offset] !== expected[offset]) break
        offset++
      }
      if (offset === expected.length) return index
    }
  }
  return undefined
}

interface Replacement {
  start: number
  oldLength: number
  newLines: readonly string[]
  order: number
  hunk: PatchHunk
}

interface Entry {
  mark: string
  text: string
}

function hunkEntries(hunk: PatchHunk): Entry[] | undefined {
  const { marks } = hunk
  if (marks === undefined) return undefined
  const entries: Entry[] = []
  let oldIndex = 0
  let newIndex = 0
  for (const mark of marks) {
    if (mark === '+') entries.push({ mark, text: hunk.newLines[newIndex++] as string })
    else {
      entries.push({ mark, text: hunk.oldLines[oldIndex++] as string })
      if (mark === ' ') newIndex++
    }
  }
  return entries
}

function withoutTrailingEmpty(entries: readonly Entry[], newEndsEmpty: boolean): Entry[] {
  const dropped = new Set([entries.findLastIndex(entry => entry.mark !== '+')])
  if (newEndsEmpty) dropped.add(entries.findLastIndex(entry => entry.mark !== '-'))
  return entries.filter((_, index) => !dropped.has(index))
}

function replacementLines(entries: readonly Entry[], original: readonly string[], found: number): string[] {
  const lines: string[] = []
  let cursor = found
  for (const entry of entries) {
    if (entry.mark === '+') lines.push(entry.text)
    else {
      if (entry.mark === ' ') lines.push(original[cursor] as string)
      cursor++
    }
  }
  return lines
}

const FAILURE_REASONS: Record<HunkApplyFailure['stage'], string> = {
  context: 'does not match',
  oldLines: 'does not match',
  overlap: 'overlaps an earlier hunk; merge the two hunks or give them separate context',
  insertion: 'only adds lines after an @@ anchor, which would append at the end of the file; add the surrounding lines to the hunk or mark it *** End of File',
  budget: 'could not be matched within the search work limit; split the patch or give the hunk fewer, more specific lines',
}

export function describeHunkFailure(failure: HunkApplyFailure): string {
  return FAILURE_REASONS[failure.stage]
}

/**
 * Apply parsed hunks to LF-normalized text without I/O or input mutation.
 * All searches use the original text; a failed search returns no partial text.
 * The final-newline state of the input is preserved; overlapping hunks and anchored insert-only hunks fail.
 * @param before - text normalized by the caller; CR characters receive no line-ending handling.
 * @param hunks - ordered hunks from parsePatch; EOF searches follow NormalizeToLf tail semantics.
 * @returns new text or the first unmatched hunk, without throwing for a match failure.
 */
export function applyHunks(before: string, hunks: readonly PatchHunk[]): ApplyHunksResult {
  const original = before.split('\n')
  if (original.at(-1) === '') original.pop()
  const matcher: Matcher = { lines: original, passes: [], remaining: MAX_MATCH_COMPARISONS }
  const replacements: Replacement[] = []
  let lineIndex = 0

  for (const [order, hunk] of hunks.entries()) {
    try {
      if (hunk.context !== undefined) {
        const pattern = [hunk.context]
        const found = seekSequence(matcher, pattern, lineIndex, false)
        if (found === undefined) {
          return { ok: false, failure: { hunkLineNumber: hunk.lineNumber, stage: 'context', searchStart: lineIndex, pattern } }
        }
        lineIndex = found + 1
        if (hunk.oldLines.length === 0 && !hunk.isEndOfFile) {
          return { ok: false, failure: { hunkLineNumber: hunk.lineNumber, stage: 'insertion', searchStart: found, pattern } }
        }
      }
      if (hunk.oldLines.length === 0) {
        replacements.push({ start: original.length, oldLength: 0, newLines: hunk.newLines, order, hunk })
        continue
      }

      let pattern = hunk.oldLines
      let newLines = hunk.newLines
      let entries = hunkEntries(hunk)
      let found = seekSequence(matcher, pattern, lineIndex, hunk.isEndOfFile)
      if (found === undefined && pattern.at(-1) === '') {
        pattern = pattern.slice(0, -1)
        const newEndsEmpty = newLines.at(-1) === ''
        if (newEndsEmpty) newLines = newLines.slice(0, -1)
        if (entries !== undefined) entries = withoutTrailingEmpty(entries, newEndsEmpty)
        found = seekSequence(matcher, pattern, lineIndex, hunk.isEndOfFile)
      }
      if (found === undefined) {
        return {
          ok: false,
          failure: { hunkLineNumber: hunk.lineNumber, stage: 'oldLines', searchStart: lineIndex, pattern: [...hunk.oldLines] },
        }
      }
      replacements.push({
        start: found, oldLength: pattern.length, order, hunk,
        newLines: entries === undefined ? newLines : replacementLines(entries, original, found),
      })
      lineIndex = found + pattern.length
    } catch (error) {
      if (!(error instanceof MatchBudgetExceeded)) throw error
      return { ok: false, failure: { hunkLineNumber: hunk.lineNumber, stage: 'budget', searchStart: lineIndex, pattern: [...hunk.oldLines] } }
    }
  }

  replacements.sort((left, right) => left.start - right.start)
  let reach: Replacement | undefined
  for (const replacement of replacements) {
    const reachEnd = reach === undefined ? 0 : reach.start + reach.oldLength
    if (reach !== undefined && replacement.start < reachEnd) {
      const later = replacement.order > reach.order ? replacement : reach
      return {
        ok: false,
        failure: { hunkLineNumber: later.hunk.lineNumber, stage: 'overlap', searchStart: replacement.start, pattern: [...later.hunk.oldLines] },
      }
    }
    if (reach === undefined || replacement.start + replacement.oldLength > reachEnd) reach = replacement
  }
  let lines = original
  for (const replacement of replacements.reverse()) {
    lines = [
      ...lines.slice(0, replacement.start),
      ...replacement.newLines,
      ...lines.slice(replacement.start + replacement.oldLength),
    ]
  }
  if (lines.length === 0) return { ok: true, after: '' }
  const terminated = before === '' || before.endsWith('\n')
  return { ok: true, after: lines.join('\n') + (terminated ? '\n' : '') }
}
