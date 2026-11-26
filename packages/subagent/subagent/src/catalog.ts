/**
 * Parent-owned durable subagent catalog events and their chunked projection.
 *
 * @module @deepseek-ai/dsh-subagent/catalog
 */

import { z } from 'zod'
import {
  appendChunkedList,
  chunkedListLength,
  chunkedListSchema,
  chunkedListSuffix,
  iterateChunkedList,
} from '@deepseek-ai/dsh-chunked-list'
import type { ChunkedList } from '@deepseek-ai/dsh-chunked-list'
import type {
  Session,
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset,
} from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { trieGet, trieSchema, trieSet } from './keyed-trie.ts'
import type { TrieNode } from './keyed-trie.ts'
import { isAgentName } from './names.ts'
import type { SubagentCatalogEntry } from './projection-types.ts'

/** Catalog payload version emitted by local and external child creation. */
export const SUBAGENT_CATALOG_VERSION = 3

type KnownCatalogMode =
  | { readonly mode: 'one-shot'; readonly label?: string }
  | { readonly mode: 'continuable'; readonly label: string }

/**
 * Parent catalog v0 records local modes, v1 adds unknown children, v2 records
 * external executions, and v3 adds each child's name, unique among its siblings.
 */
export type SubagentCatalogEvent =
  & {
    readonly childId: SessionId
    readonly childCreatedAt: number
  } & (
    | ({ readonly version: 0 } & KnownCatalogMode)
    | ({ readonly version: 1 } & (KnownCatalogMode | { readonly mode: 'unknown'; readonly label?: string }))
    | { readonly version: 2; readonly mode: 'external'; readonly label?: string }
    | ({ readonly version: 3; readonly name: string } & (
      | { readonly mode: 'continuable'; readonly label: string }
      | { readonly mode: 'external'; readonly label?: string }
    ))
  )

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A direct child's identity and available discovery fields.
     * @param data - versioned parent-owned catalog entry.
     */
    'subagent/catalog': SubagentCatalogEvent
  }
}

/** Host fold state for one parent catalog. */
export interface SubagentCatalogState {
  readonly inheritedEventCount: SessionLogOffset
  readonly head?: ChunkedList<SubagentCatalogEvent> | undefined
  readonly children: TrieNode
  readonly names: TrieNode
  readonly agentOrdinal: number
}

const sessionIdSchema = z.string() as unknown as z.ZodType<SessionId>
const oneShotCatalogSchema = z.object({
  version: z.union([z.literal(0), z.literal(1)]),
  childId: sessionIdSchema,
  childCreatedAt: z.number().int().nonnegative(),
  mode: z.literal('one-shot'),
  label: z.string().optional(),
}).strict()
const continuableCatalogSchema = z.object({
  version: z.union([z.literal(0), z.literal(1)]),
  childId: sessionIdSchema,
  childCreatedAt: z.number().int().nonnegative(),
  mode: z.literal('continuable'),
  label: z.string(),
}).strict()
const externalCatalogSchema = oneShotCatalogSchema.extend({ version: z.literal(2), mode: z.literal('external') })
const unknownCatalogSchema = oneShotCatalogSchema.extend({ version: z.literal(1), mode: z.literal('unknown') })
const nameSchema = z.string().refine(isAgentName, 'invalid agent name')
const namedContinuableCatalogSchema = continuableCatalogSchema.extend({ version: z.literal(3), name: nameSchema })
const namedExternalCatalogSchema = externalCatalogSchema.extend({ version: z.literal(3), name: nameSchema })
const eventDataSchema = z.union([
  oneShotCatalogSchema,
  externalCatalogSchema,
  continuableCatalogSchema,
  unknownCatalogSchema,
  namedContinuableCatalogSchema,
  namedExternalCatalogSchema,
]) as z.ZodType<SubagentCatalogEvent>
const viewSchema = z.array(z.union([
  oneShotCatalogSchema.omit({ version: true, childId: true, childCreatedAt: true }).extend({
    id: sessionIdSchema,
    createdAt: oneShotCatalogSchema.shape.childCreatedAt,
  }),
  externalCatalogSchema.omit({ version: true, childId: true, childCreatedAt: true }).extend({
    id: sessionIdSchema,
    createdAt: externalCatalogSchema.shape.childCreatedAt,
    name: nameSchema.optional(),
  }),
  continuableCatalogSchema.omit({ version: true, childId: true, childCreatedAt: true }).extend({
    id: sessionIdSchema,
    createdAt: continuableCatalogSchema.shape.childCreatedAt,
    name: nameSchema.optional(),
  }),
  unknownCatalogSchema.omit({ version: true, childId: true, childCreatedAt: true }).extend({
    id: sessionIdSchema,
    createdAt: unknownCatalogSchema.shape.childCreatedAt,
  }),
])) as z.ZodType<SubagentCatalogEntry[]>
const stateSchema: z.ZodType<SubagentCatalogState> = z.object({
  inheritedEventCount: z.number().int().nonnegative() as unknown as z.ZodType<SessionLogOffset>,
  head: chunkedListSchema(eventDataSchema).optional(),
  children: trieSchema,
  names: trieSchema,
  agentOrdinal: z.number().int().nonnegative(),
}).strict()

/**
 * Materialize complete and unknown-mode child identities from parent catalog events.
 * @param state - parent catalog fold state.
 * @returns current direct-child rows in parent catalog event order.
 */
function subagentCatalogEntries(state: SubagentCatalogState): SubagentCatalogEntry[] {
  const entries: SubagentCatalogEntry[] = []
  for (const data of iterateChunkedList(state.head)) entries.push(catalogEntry(data))
  return entries
}

function catalogEntry(data: SubagentCatalogEvent): SubagentCatalogEntry {
  const { version: _version, childId, childCreatedAt, ...descriptor } = data
  return { id: childId, createdAt: childCreatedAt, ...descriptor }
}

/** Parent-owned catalog; version-8 checkpoints must carry the child and name indexes, and invalid own facts reject restoration. */
export const subagentCatalogProjectionDefinition = {
  key: 'subagentCatalog',
  stateSchema,
  init: (_header: SessionHeader, inheritedEventCount: SessionLogOffset) => (
    { inheritedEventCount, children: {}, names: {}, agentOrdinal: 0 }
  ),
  apply: (state, event: SessionEvent) => {
    if (event.type !== 'subagent/catalog' || event.seq < state.inheritedEventCount) return state
    const data = eventDataSchema.parse(event.data)
    const head = appendChunkedList(state.head, data)
    const children = trieSet(state.children, data.childId, 'name' in data ? data.name : '')
    if (!('name' in data)) return { ...state, head, children }
    const names = trieSet(state.names, data.name, data.childId)
    let agentOrdinal = state.agentOrdinal
    while (trieGet(names, `agent-${agentOrdinal + 1}`) !== undefined) agentOrdinal++
    return { ...state, head, children, names, agentOrdinal }
  },
  stateVersion: 8,
  wire: {
    viewSchema,
    view: subagentCatalogEntries,
    appended: (prev, next) => {
      const from = chunkedListLength(prev.head)
      const count = chunkedListLength(next.head) - from
      if (count <= 0) return undefined
      return { from, items: chunkedListSuffix(next.head, count).map(catalogEntry) }
    },
  },
} satisfies ProjectionDefinition<'subagentCatalog', SubagentCatalogState>

/**
 * Append a complete direct-child discovery fact to its parent Session.
 * @param parent - durable direct parent receiving the discovery fact.
 * @param child - established child's immutable Session metadata.
 * @param descriptor - mode-discriminated creation label frozen with the child.
 * @param name - the child's name, reserved unique among the parent's children.
 */
export function establishCatalogChild(
  parent: Session,
  child: SessionHeader,
  descriptor: { readonly mode: 'continuable'; readonly label: string },
  name: string,
): void {
  parent.append('subagent/catalog', {
    version: SUBAGENT_CATALOG_VERSION,
    childId: child.id,
    childCreatedAt: child.createdAt,
    mode: descriptor.mode,
    label: descriptor.label,
    name,
  })
}

/**
 * Record an external execution without a local child Session.
 * @param parent - durable direct parent receiving the discovery fact.
 * @param childId - identity returned by the external provider.
 * @param label - display label assigned by the caller.
 * @param name - the child's name, reserved unique among the parent's children.
 */
export function establishExternalCatalogChild(parent: Session, childId: SessionId, label: string, name: string): void {
  parent.append('subagent/catalog', {
    version: SUBAGENT_CATALOG_VERSION,
    childId,
    childCreatedAt: Date.now(),
    mode: 'external',
    label,
    name,
  })
}

export function catalogChild(state: { readonly children: unknown }, childId: SessionId): { readonly name: string | undefined } | undefined {
  const name = trieGet(state.children, childId)
  return name === undefined ? undefined : { name: name === '' ? undefined : name }
}

export function catalogHasName(state: SubagentCatalogState, name: string): boolean {
  return trieGet(state.names, name) !== undefined
}
