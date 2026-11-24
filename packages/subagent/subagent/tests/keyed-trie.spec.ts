import { describe, expect, it } from 'vitest'
import { trieGet, trieSchema, trieSet } from '../src/keyed-trie.ts'
import type { TrieNode } from '../src/keyed-trie.ts'

const collidingKeys = ['c2ya8', 'czki6'] as const

function depthOf(node: TrieNode): number {
  return 1 + Math.max(0, ...Object.values(node).map(child => Array.isArray(child) ? 0 : depthOf(child as TrieNode)))
}

describe('keyed trie', () => {
  it('stores, overwrites, and reads keys without modifying earlier roots', () => {
    const empty: TrieNode = {}
    const one = trieSet(empty, 'alpha', 'a')
    const two = trieSet(one, 'beta', 'b')
    const over = trieSet(two, 'alpha', 'z')
    expect(empty).toEqual({})
    expect(trieGet(one, 'beta')).toBeUndefined()
    expect([trieGet(two, 'alpha'), trieGet(two, 'beta'), trieGet(two, 'gamma')]).toEqual(['a', 'b', undefined])
    expect(trieGet(over, 'alpha')).toBe('z')
    expect(trieGet(two, 'alpha')).toBe('a')
  })

  it('splits shared slots and keeps every key of a large set readable at bounded depth', () => {
    let root: TrieNode = {}
    for (let index = 0; index < 20_000; index++) root = trieSet(root, `key-${index}`, String(index))
    expect([0, 1, 9999, 19_999].map(index => trieGet(root, `key-${index}`))).toEqual(['0', '1', '9999', '19999'])
    expect(trieGet(root, 'key-20000')).toBeUndefined()
    expect(depthOf(root)).toBeLessThanOrEqual(8)
    expect(trieSchema.parse(JSON.parse(JSON.stringify(root)))).toEqual(root)
  })

  it('keeps full-hash collisions in one bucket and overwrites inside it', () => {
    let root = trieSet(trieSet({}, collidingKeys[0], 'first'), collidingKeys[1], 'second')
    expect(collidingKeys.map(key => trieGet(root, key))).toEqual(['first', 'second'])
    root = trieSet(root, collidingKeys[1], 'again')
    expect(collidingKeys.map(key => trieGet(root, key))).toEqual(['first', 'again'])
    expect(trieSchema.parse(JSON.parse(JSON.stringify(root)))).toEqual(root)
  })

  it('rejects malformed, over-deep, and misplaced checkpoints', () => {
    const valid = trieSet({}, 'alpha', 'a')
    const [slot, leaf] = Object.entries(valid)[0]!
    expect(trieSchema.safeParse({ [slot === '0' ? '1' : '0']: leaf }).success).toBe(false)
    expect(trieSchema.safeParse({ [slot]: [['alpha', 'a'], ['beta', 'b']] }).success).toBe(false)
    expect(trieSchema.safeParse({ [slot]: [] }).success).toBe(false)
    expect(trieSchema.safeParse({ xx: leaf }).success).toBe(false)
    expect(trieSchema.safeParse({ [slot]: [['alpha', 1]] }).success).toBe(false)
    let nested: unknown = [['alpha', 'a']]
    for (let level = 0; level < 9; level++) nested = { [slot]: nested }
    expect(trieSchema.safeParse(nested).success).toBe(false)
  })

  it('reads unchecked stored JSON as absent instead of throwing', () => {
    const valid = trieSet({}, 'alpha', 'a')
    const [slot, leaf] = Object.entries(valid)[0]!
    const deep: unknown = Array.from({ length: 9 }).reduce<unknown>(node => ({ [slot]: node }), leaf)
    const malformed: unknown[] = [undefined, null, 'x', 7, [], [['alpha']], { [slot]: 'alpha' }, { [slot]: [['alpha', 1]] }, { [slot]: [null] }, deep]
    for (const root of malformed) expect(trieGet(root, 'alpha')).toBeUndefined()
    expect(trieGet(valid, 'alpha')).toBe('a')
  })
})
