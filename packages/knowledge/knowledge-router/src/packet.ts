/** @module @deepseek-ai/dsh-knowledge-router/packet */

import type {
  Freshness,
  KnowledgeItem,
  KnowledgePacket,
  KnowledgeProviderName,
  KnowledgeSignals,
} from './types.ts'

/** Signals for a provider that reports none. */
export const NO_SIGNALS: KnowledgeSignals = Object.freeze({
  lessonsObserved: 0,
  staleLessons: 0,
  lessonStatuses: [],
})

/** Graphify's per-node lesson annotation, as emitted inside query output. */
const LESSON_ANNOTATION = /learning=([a-z][a-z-]*)(:stale)?/gi

/** The packet fields rendering reads, structurally satisfied by {@link KnowledgePacket}. */
export interface RenderablePacket {
  /** The task text the items answer. */
  readonly task: string
  /** Providers actually queried, in query order. */
  readonly providers: readonly string[]
  /** Providers a routing decision selected but that were unavailable. */
  readonly unavailable: readonly string[]
  /** Retrieved items, in query order. */
  readonly items: readonly {
    /** Provider that produced the text. */
    readonly provider: string
    /** MCP client `serverName` the query was dispatched through. */
    readonly serverName: string
    /** The provider's own output, unmodified. */
    readonly text: string
    /** Provider-reported freshness, or `unknown`. */
    readonly freshness: { readonly kind: string; readonly detail?: string }
    /** ISO-8601 instant this item was retrieved. */
    readonly retrievedAt: string
  }[]
}

/** Everything one packet needs before bounding. */
export interface PacketInput {
  readonly task: string
  readonly requestedBy?: string
  readonly providers: KnowledgeProviderName[]
  readonly unavailable: KnowledgeProviderName[]
  readonly items: KnowledgeItem[]
  readonly maxBytes: number
}

/**
 * UTF-8 byte length of one string.
 * @param text - the text to measure.
 * @returns The number of UTF-8 bytes the text occupies.
 */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * Read the lesson annotations a provider emitted into its own text output.
 * @param text - the provider's output, unmodified.
 * @returns Observed lesson count, stale count, and distinct statuses.
 */
export function extractLessonSignals(text: string): KnowledgeSignals {
  const statuses = new Set<string>()
  let lessonsObserved = 0
  let staleLessons = 0
  for (const match of text.matchAll(LESSON_ANNOTATION)) {
    const status = match[1] as string
    lessonsObserved += 1
    statuses.add(status.toLowerCase())
    if (match[2] !== undefined) staleLessons += 1
  }
  return {
    lessonsObserved,
    staleLessons,
    lessonStatuses: [...statuses].sort(),
  }
}

/**
 * Resolve an item's freshness from its provider, the signals observed in its
 * text, and — when the provider was probed — the lesson state it reported.
 *
 * A probed lesson state wins over annotations parsed from the text, because a
 * probe reads the provider's own overlay while the annotation is presentation.
 *
 * @param provider - provider that produced the text.
 * @param signals - signals extracted from that text.
 * @param lesson - the probed lesson state, when the provider was asked for one.
 * @returns Provider-vocabulary freshness; `unknown` when nothing readable was reported.
 */
export function freshnessFor(
  provider: KnowledgeProviderName,
  signals: KnowledgeSignals,
  lesson?: { readonly node: string; readonly status?: string; readonly stale: boolean },
): Freshness {
  if (lesson !== undefined) {
    if (lesson.stale) {
      return { kind: 'stale', detail: `Graphify marked the lesson for ${lesson.node} as needing reverification` }
    }
    return lesson.status === undefined ? { kind: 'unknown' } : { kind: 'current' }
  }
  if (provider !== 'graphify' || signals.lessonsObserved === 0) return { kind: 'unknown' }
  if (signals.staleLessons > 0) {
    return {
      kind: 'stale',
      detail: `Graphify marked ${String(signals.staleLessons)} of ${String(signals.lessonsObserved)} lesson annotations stale`,
    }
  }
  return { kind: 'current' }
}

/** Render the model- and human-facing packet text. */
function renderText(packet: RenderablePacket): string {
  const lines = [
    'TASK',
    packet.task,
    '',
    'KNOWLEDGE PROVIDERS',
    `queried: ${packet.providers.join(', ') || 'none'}`,
  ]
  if (packet.unavailable.length > 0) lines.push(`unavailable: ${packet.unavailable.join(', ')}`)
  for (const item of packet.items) {
    lines.push('', item.provider === 'gitnexus' ? 'CODE INTELLIGENCE' : 'LEARNED CONTEXT')
    const freshness = item.freshness.kind === 'stale'
      ? `STALE - REVERIFY (${item.freshness.detail ?? ''})`
      : item.freshness.kind
    lines.push(`Source: ${item.provider} (server: ${item.serverName}, freshness: ${freshness}, retrieved: ${item.retrievedAt})`)
    lines.push('', item.text)
  }
  return lines.join('\n')
}

/**
 * Cut one string to a maximum length without splitting a surrogate pair.
 * @param text - the text to cut.
 * @param cap - maximum UTF-16 code units to keep.
 * @returns A prefix ending on a whole character.
 */
function cutTo(text: string, cap: number): string {
  const cut = text.slice(0, cap)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/** One item's text shortened to a length cap with a visible marker. */
function shorten(item: KnowledgeItem, cap: number): KnowledgeItem {
  if (item.text.length <= cap) return item
  return { ...item, text: `${cutTo(item.text, cap)}\n[provider output truncated]` }
}

/**
 * Conservative bytes one item contributes besides its provider text: the
 * section label, the source references line, separating newlines, and the truncation
 * marker. Subtracting it keeps a shortened item inside the packet bound.
 */
const ITEM_OVERHEAD_BYTES = 160

/** Apply the byte bound by shortening item text, then dropping trailing items. */
function boundItems(input: PacketInput): { readonly items: KnowledgeItem[]; readonly truncated: boolean } {
  if (byteLength(renderText(input)) <= input.maxBytes) return { items: input.items, truncated: false }
  const emptyBytes = byteLength(renderText({ ...input, items: [] }))
  const available = input.maxBytes - emptyBytes
  let items = input.items
  if (items.length > 0 && available > 0) {
    const perItem = Math.max(1, Math.floor(available / items.length) - ITEM_OVERHEAD_BYTES)
    items = items.map(item => shorten(item, perItem))
  }
  while (items.length > 0 && byteLength(renderText({ ...input, items })) > input.maxBytes) {
    items = items.slice(0, -1)
  }
  return { items, truncated: true }
}

/**
 * Assemble a bounded packet from retrieved items.
 * @param input - task, provider accounting, items, and the byte bound.
 * @returns The packet, its rendered byte length, and whether bounding removed text.
 */
export function assemblePacket(input: PacketInput): KnowledgePacket {
  const bounded = boundItems(input)
  return {
    task: input.task,
    ...input.requestedBy !== undefined ? { requestedBy: input.requestedBy } : {},
    providers: input.providers,
    unavailable: input.unavailable,
    items: bounded.items,
    bytes: byteLength(renderText({ ...input, items: bounded.items })),
    truncated: bounded.truncated,
  }
}

/**
 * Render a packet for a model or a human reader.
 * @param packet - the assembled packet, or any value carrying its fields.
 * @returns The packet text whose byte length {@link KnowledgePacket.bytes} reports.
 */
export function renderPacket(packet: RenderablePacket): string {
  return renderText(packet)
}
