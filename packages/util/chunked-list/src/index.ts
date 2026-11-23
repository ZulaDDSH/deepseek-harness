/**
 * Persistent append-only lists with bounded copying and JSON checkpoint validation.
 * @module @deepseek-ai/dsh-chunked-list
 */

import { z } from 'zod'

const CHUNK_CAPACITY = 64
const MAX_HEIGHT = 8

export type ChunkedBlock<T> =
  | { readonly height: 0; readonly values: readonly T[] }
  | { readonly height: number; readonly children: readonly ChunkedBlock<T>[] }

/**
 * Immutable list that must keep sealed blocks oldest first before a short tail; `undefined` represents the empty list.
 * Callers must treat blocks, arrays, and stored values as immutable; operations share values and older blocks.
 */
export interface ChunkedList<T> {
  readonly tail: readonly T[]
  readonly blocks: readonly ChunkedBlock<T>[]
}

/**
 * Append without modifying the input, copying at most one 64-value chunk.
 * @param head - current list, or `undefined` for an empty list.
 * @param value - value to retain by reference.
 * @returns new list sharing the unchanged older chunks.
 */
export function appendChunkedList<T>(head: ChunkedList<T> | undefined, value: T): ChunkedList<T> {
  const tail = [...head?.tail ?? [], value]
  const blocks = head?.blocks ?? []
  if (tail.length < CHUNK_CAPACITY) return { tail, blocks }
  const next: ChunkedBlock<T>[] = [...blocks, { height: 0, values: tail }]
  for (;;) {
    const height = next[next.length - 1]!.height
    let start = next.length
    while (start > 0 && next[start - 1]!.height === height) start -= 1
    if (next.length - start < CHUNK_CAPACITY) return { tail: [], blocks: next }
    next.splice(start, CHUNK_CAPACITY, { height: height + 1, children: next.slice(start) })
  }
}

function* walk<T>(block: ChunkedBlock<T>): Generator<T> {
  if ('values' in block) yield* block.values
  else for (const child of block.children) yield* walk(child)
}

function* walkBackward<T>(block: ChunkedBlock<T>): Generator<T> {
  if ('values' in block) {
    for (let index = block.values.length - 1; index >= 0; index -= 1) yield block.values[index]!
  } else {
    for (let index = block.children.length - 1; index >= 0; index -= 1) yield* walkBackward(block.children[index]!)
  }
}

export function chunkedListLength<T>(head: ChunkedList<T> | undefined): number {
  if (head === undefined) return 0
  let length = head.tail.length
  for (const block of head.blocks) length += CHUNK_CAPACITY ** (block.height + 1)
  return length
}

export function chunkedListSuffix<T>(head: ChunkedList<T> | undefined, count: number): T[] {
  const suffix: T[] = []
  if (head === undefined) return suffix
  for (let index = head.tail.length - 1; index >= 0 && suffix.length < count; index -= 1) suffix.push(head.tail[index]!)
  for (let index = head.blocks.length - 1; index >= 0 && suffix.length < count; index -= 1) {
    for (const value of walkBackward(head.blocks[index]!)) {
      if (suffix.length >= count) break
      suffix.push(value)
    }
  }
  return suffix.reverse()
}

/**
 * Visit all values in insertion order in O(N) time; scratch space must stay bounded by the block height.
 * @param head - current list, or `undefined` for an empty list.
 * @returns iterator yielding the stored values by reference, without truncation.
 */
export function* iterateChunkedList<T>(head: ChunkedList<T> | undefined): Generator<T> {
  if (head === undefined) return
  for (const block of head.blocks) yield* walk(block)
  yield* head.tail
}

function orderedBlocks<T>(blocks: readonly ChunkedBlock<T>[]): boolean {
  let run = 0
  for (const [index, block] of blocks.entries()) {
    const previous = blocks[index - 1]
    if (previous !== undefined && block.height > previous.height) return false
    run = previous?.height === block.height ? run + 1 : 1
    if (run >= CHUNK_CAPACITY) return false
  }
  return true
}

/**
 * Validate nonempty list checkpoints; every block must have its exact width and descending height.
 * @param valueSchema - caller-owned validation for each stored value.
 * @returns Zod schema rejecting empty lists, mis-sized or mis-ordered blocks and unknown fields.
 */
export function chunkedListSchema<T>(valueSchema: z.ZodType<T>): z.ZodType<ChunkedList<T>> {
  const block: z.ZodType<ChunkedBlock<T>> = z.lazy((): z.ZodType<ChunkedBlock<T>> => z.union([
    z.object({ height: z.literal(0), values: z.array(valueSchema).length(CHUNK_CAPACITY) }).strict(),
    z.object({ height: z.number().int().min(1).max(MAX_HEIGHT), children: z.array(block).length(CHUNK_CAPACITY) }).strict()
      .refine(({ height, children }) => children.every(child => child.height === height - 1)),
  ]))
  return z.object({
    tail: z.array(valueSchema).max(CHUNK_CAPACITY - 1),
    blocks: z.array(block),
  }).strict().refine(list => (list.tail.length > 0 || list.blocks.length > 0) && orderedBlocks(list.blocks))
}
