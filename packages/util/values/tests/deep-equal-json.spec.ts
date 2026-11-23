import { describe, expect, it } from 'vitest'
import { deepEqualJson } from '../src/index.ts'

describe('deepEqualJson', () => {
  it('compares nested values regardless of key order', () => {
    expect(deepEqualJson({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toBe(true)
    expect(deepEqualJson({ a: 1 }, { a: 2 })).toBe(false)
  })

  it('does not treat inherited names as present keys, in either argument order', () => {
    const protoKey = JSON.parse('{"__proto__":{}}') as unknown
    const other = JSON.parse('{"x":1}') as unknown
    expect(deepEqualJson(protoKey, other)).toBe(false)
    expect(deepEqualJson(other, protoKey)).toBe(false)
    expect(deepEqualJson(JSON.parse('{"toString":{}}'), JSON.parse('{"x":1}'))).toBe(false)
    expect(deepEqualJson(JSON.parse('{"constructor":1}'), JSON.parse('{"x":1}'))).toBe(false)
  })

  it('compares an own __proto__ key by value', () => {
    expect(deepEqualJson(JSON.parse('{"__proto__":{"a":1}}'), JSON.parse('{"__proto__":{"a":1}}'))).toBe(true)
    expect(deepEqualJson(JSON.parse('{"__proto__":{"a":1}}'), JSON.parse('{"__proto__":{"a":2}}'))).toBe(false)
  })
})
