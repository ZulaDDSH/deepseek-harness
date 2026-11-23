import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { appendChunkedList, chunkedListSchema, iterateChunkedList } from '../src/index.ts'
import type { ChunkedBlock, ChunkedList } from '../src/index.ts'

function depth<T>(block: ChunkedBlock<T>): number {
  return 'children' in block ? 1 + Math.max(...block.children.map(depth)) : 1
}

function build(count: number): ChunkedList<number> | undefined {
  let head: ChunkedList<number> | undefined
  for (let value = 0; value < count; value += 1) head = appendChunkedList(head, value)
  return head
}

describe('persistent chunked list', () => {
  it('iterates an empty list and retains undefined values', () => {
    expect([...iterateChunkedList(undefined)]).toEqual([])
    const head = appendChunkedList(undefined, undefined)
    expect([...iterateChunkedList(head)]).toEqual([undefined])
  })

  it('keeps every prefix unchanged across rollovers and divergent appends', () => {
    let head: ChunkedList<number> | undefined
    const prefixes: ChunkedList<number>[] = []
    for (let value = 0; value < 4_300; value += 1) {
      head = appendChunkedList(head, value)
      Object.freeze(head.tail)
      Object.freeze(head.blocks)
      Object.freeze(head)
      prefixes.push(head)
    }
    for (const index of [0, 62, 63, 64, 65, 127, 128, 4_095, 4_096, 4_097, 4_299]) {
      expect([...iterateChunkedList(prefixes[index])]).toEqual(Array.from({ length: index + 1 }, (_, i) => i))
    }
    expect([...iterateChunkedList(appendChunkedList(prefixes[64], -1))])
      .toEqual([...Array.from({ length: 65 }, (_, i) => i), -1])
    expect([...iterateChunkedList(prefixes[65])]).toEqual(Array.from({ length: 66 }, (_, i) => i))
    expect(prefixes[64]?.blocks[0]).toBe(prefixes[63]?.blocks[0] ?? prefixes[64]?.blocks[0])
    expect(prefixes[200]?.blocks[0]).toBe(prefixes[100]?.blocks[0])
  })

  it('retains stored objects by reference', () => {
    const value = Object.freeze({ id: 'first' })
    expect([...iterateChunkedList(appendChunkedList(undefined, value))][0]).toBe(value)
  })

  it('bounds nesting by the height, not by the number of values', () => {
    const list = build(64 * 64 * 64 + 1)
    expect(Math.max(...list!.blocks.map(depth))).toBe(3)
    expect(list?.blocks.map(block => block.height)).toEqual([2])
    expect(JSON.stringify(list)).toBeTypeOf('string')
    expect(() => structuredClone(list)).not.toThrow()
    const large = build(200_000)
    expect(Math.max(...large!.blocks.map(depth))).toBeLessThanOrEqual(4)
    expect([...iterateChunkedList(structuredClone(large))]).toHaveLength(200_000)
  })

  it('restores JSON checkpoints and appends at and after every rollover', () => {
    const schema = chunkedListSchema(z.number())
    let head: ChunkedList<number> | undefined
    for (let value = 0; value < 4_200; value += 1) {
      head = appendChunkedList(head, value)
      if (value % 64 < 2 || value > 4_090) head = schema.parse(JSON.parse(JSON.stringify(head)))
    }
    expect([...iterateChunkedList(head)]).toEqual(Array.from({ length: 4_200 }, (_, i) => i))
  })

  const full = (value: number, height = 0): ChunkedBlock<number> => height === 0
    ? { height: 0, values: Array.from({ length: 64 }, () => value) }
    : { height, children: Array.from({ length: 64 }, () => full(value, height - 1)) }

  it.each([
    { tail: [], blocks: [] },
    { tail: Array.from({ length: 64 }, () => 0), blocks: [] },
    { tail: ['invalid'], blocks: [] },
    { tail: [0], blocks: [], extra: true },
    { tail: [], blocks: [{ height: 0, values: [] }] },
    { tail: [], blocks: [{ height: 0, values: [0] }] },
    { tail: [], blocks: [{ height: 0, values: Array.from({ length: 65 }, () => 0) }] },
    { tail: [], blocks: [{ height: 0, values: Array.from({ length: 64 }, () => 'invalid') }] },
    { tail: [], blocks: [{ ...full(0), extra: true }] },
    { tail: [], blocks: [{ height: 1, children: Array.from({ length: 64 }, () => full(0, 1)) }] },
    { tail: [], blocks: [{ height: 1, children: [full(0)] }] },
    { tail: [], blocks: [full(0), full(0, 1)] },
    { tail: [], blocks: Array.from({ length: 64 }, () => full(0)) },
    { tail: [], blocks: [{ height: 1.5, children: [] }] },
  ])('rejects an invalid checkpoint: %j', (checkpoint) => {
    expect(() => chunkedListSchema(z.number()).parse(JSON.parse(JSON.stringify(checkpoint)))).toThrow(z.ZodError)
  })

  it('accepts sealed blocks of descending height followed by a tail', () => {
    const checkpoint = { tail: [1], blocks: [full(0, 1), full(0), full(0)] }
    expect([...iterateChunkedList(chunkedListSchema(z.number()).parse(checkpoint))]).toHaveLength(64 * 64 + 128 + 1)
  })
})
