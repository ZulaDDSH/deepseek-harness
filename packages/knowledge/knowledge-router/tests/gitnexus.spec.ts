/**
 * GitNexus result parsing, driven by payloads captured from the real 1.6.12
 * MCP server: its JSON result, a `---` separator, then an appended hint.
 */

import { describe, expect, it } from 'vitest'
import { gitnexusFreshness, parseStaleness } from '../src/gitnexus.ts'

/** A GitNexus result captured from the real server with the index behind HEAD. */
const BEHIND = '{\n'
  + '  "status": "found",\n'
  + '  "symbol": { "name": "closeSession", "kind": "Function" },\n'
  + '  "epistemic": "exact",\n'
  + '  "staleness": {\n'
  + '    "status": "behind",\n'
  + '    "hint": "Index is 1 commit behind HEAD. Run analyze tool to update."\n'
  + '  }\n'
  + '}\n'
  + '\n---\n'
  + '**Next:** If planning changes, use impact({target: "closeSession"}).'

/** A GitNexus result captured with the index at HEAD: no staleness key at all. */
const CURRENT = '{\n  "status": "found",\n  "symbol": { "name": "closeSession" }\n}'

describe('parseStaleness', () => {
  it('reads the staleness block past the appended hint', () => {
    expect(parseStaleness(BEHIND)).toEqual({
      status: 'behind',
      hint: 'Index is 1 commit behind HEAD. Run analyze tool to update.',
    })
  })

  it('reports nothing when the provider attached no staleness block', () => {
    expect(parseStaleness(CURRENT)).toBeUndefined()
  })

  it('reports nothing for text that is not the provider JSON payload', () => {
    expect(parseStaleness('provider down')).toBeUndefined()
    expect(parseStaleness('')).toBeUndefined()
  })

  it('keeps a commit count when the provider reports one', () => {
    expect(parseStaleness('{"staleness": {"status": "behind", "commitsBehind": 3}}'))
      .toEqual({ status: 'behind', commitsBehind: 3 })
  })

  it('ignores a staleness value that is not an object with a status', () => {
    expect(parseStaleness('{"staleness": "behind"}')).toBeUndefined()
    expect(parseStaleness('{"staleness": {"hint": "no status"}}')).toBeUndefined()
    expect(parseStaleness('null')).toBeUndefined()
  })

  it('ignores optional staleness fields with the wrong type', () => {
    expect(parseStaleness('{"staleness": {"status": "behind", "commitsBehind": "3", "hint": 3}}'))
      .toEqual({ status: 'behind' })
  })
})

describe('gitnexusFreshness', () => {
  it('surfaces a behind index with the provider hint', () => {
    const freshness = gitnexusFreshness(parseStaleness(BEHIND))
    expect(freshness.kind).toBe('stale')
    if (freshness.kind !== 'stale') throw new Error('expected a stale freshness')
    expect(freshness.detail).toContain('1 commit behind HEAD')
  })

  it('reports current only when the provider said so', () => {
    expect(gitnexusFreshness({ status: 'current' })).toEqual({ kind: 'current' })
  })

  it('never claims currency when the provider reported nothing', () => {
    expect(gitnexusFreshness(undefined)).toEqual({ kind: 'unknown' })
  })

  it('falls back to the status word when the provider sent no hint', () => {
    const freshness = gitnexusFreshness({ status: 'diverged' })
    expect(freshness.kind).toBe('stale')
    if (freshness.kind !== 'stale') throw new Error('expected a stale freshness')
    expect(freshness.detail).toContain('diverged')
  })
})
