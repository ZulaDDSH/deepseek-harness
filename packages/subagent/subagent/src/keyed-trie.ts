import { z } from 'zod'

const LEVELS = 8
const SLOT_PATTERN = /^[0-9a-f]$/u

type Entry = readonly [key: string, value: string]
type Leaf = readonly Entry[]
export interface TrieNode { readonly [slot: string]: TrieNode | Leaf }

function hashOf(key: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193)
  return hash >>> 0
}

function slotOf(hash: number, level: number): string {
  return ((hash >>> (28 - 4 * level)) & 15).toString(16)
}

export function trieGet(root: unknown, key: string): string | undefined {
  const hash = hashOf(key)
  let node: unknown = root
  for (let level = 0; level < LEVELS && !Array.isArray(node); level++) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[slotOf(hash, level)] : undefined
  }
  const entry: unknown = Array.isArray(node) ? node.find(candidate => Array.isArray(candidate) && candidate[0] === key) : undefined
  const value: unknown = Array.isArray(entry) ? entry[1] : undefined
  return typeof value === 'string' ? value : undefined
}

function insert(node: TrieNode, hash: number, level: number, entry: Entry): TrieNode {
  const slot = slotOf(hash, level)
  const current = node[slot]
  if (current === undefined) return { ...node, [slot]: [entry] }
  if (!Array.isArray(current)) return { ...node, [slot]: insert(current as TrieNode, hash, level + 1, entry) }
  const leaf = current as Leaf
  const held = leaf.findIndex(candidate => candidate[0] === entry[0])
  if (held >= 0) return { ...node, [slot]: leaf.with(held, entry) }
  if (level === LEVELS - 1) return { ...node, [slot]: [...leaf, entry] }
  const split = leaf.reduce<TrieNode>((acc, other) => insert(acc, hashOf(other[0]), level + 1, other), {})
  return { ...node, [slot]: insert(split, hash, level + 1, entry) }
}

export function trieSet(root: TrieNode, key: string, value: string): TrieNode {
  return insert(root, hashOf(key), 0, [key, value])
}

function nodeSchema(level: number): z.ZodType<TrieNode> {
  const leaf = z.array(z.tuple([z.string(), z.string()])).min(1)
  const slots = level === LEVELS - 1 ? leaf : z.union([leaf.length(1), nodeSchema(level + 1)])
  return z.record(z.string().regex(SLOT_PATTERN), slots)
}

function placed(node: TrieNode, prefix: readonly string[]): boolean {
  return Object.entries(node).every(([slot, child]) => Array.isArray(child)
    ? (child as Leaf).every(([key]) => [...prefix, slot].every((digit, level) => slotOf(hashOf(key), level) === digit))
    : placed(child as TrieNode, [...prefix, slot]))
}

export const trieSchema: z.ZodType<TrieNode> = nodeSchema(0).refine(root => placed(root, []))
