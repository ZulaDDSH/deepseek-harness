/** @module @deepseek-ai/dsh-knowledge-router/types */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** Deployment-selected automatic-retrieval mode. */
export type KnowledgeMode = 'off' | 'manual' | 'assisted'

/** The knowledge providers this package can route a task to. */
export type KnowledgeProviderName = 'gitnexus' | 'graphify'

/** One configured provider and whether its MCP server is currently connected. */
export interface ProviderStatus {
  /** Provider identity used in routing decisions and packet source references. */
  readonly provider: KnowledgeProviderName
  /** Whether deployment configuration enables this provider. */
  readonly enabled: boolean
  /** MCP client `serverName` this provider's tools are registered under. */
  readonly serverName: string
  /** Whether the MCP client currently exposes this server's tools. */
  readonly connected: boolean
  /** Raw MCP tool names this server exposes, sorted; empty while disconnected. */
  readonly tools: string[]
}

/**
 * Freshness of the knowledge one item was retrieved from, in the owning
 * provider's own vocabulary. `unknown` is the honest default: it means the
 * provider reported nothing this package can read, never that the knowledge is
 * current.
 */
export type Freshness =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'current' }
  | { readonly kind: 'stale'; readonly detail: string }

/** Provider-reported lesson signals carried verbatim from the provider's output. */
export interface KnowledgeSignals {
  /** Number of lesson annotations the provider emitted. */
  readonly lessonsObserved: number
  /** Number of those annotations the provider marked stale. */
  readonly staleLessons: number
  /** Distinct lesson statuses observed, sorted, such as `preferred` or `contested`. */
  readonly lessonStatuses: string[]
}

/** One retrieved knowledge item with the source references this package can prove. */
export interface KnowledgeItem {
  /** Provider that produced the text. */
  readonly provider: KnowledgeProviderName
  /** MCP client `serverName` the query was dispatched through. */
  readonly serverName: string
  /** The task text this item answers. */
  readonly task: string
  /** The provider's own bounded output, unmodified. */
  readonly text: string
  /** Provider-reported freshness, or `unknown`. */
  readonly freshness: Freshness
  /** Provider-reported lesson signals; all zero for providers that report none. */
  readonly signals: KnowledgeSignals
  /** ISO-8601 instant this item was retrieved. */
  readonly retrievedAt: string
}

/** A bounded set of retrieved knowledge items for one task. */
export interface KnowledgePacket {
  /** The task text the items answer. */
  readonly task: string
  /** Caller identity the packet was built for, when the caller supplied one. */
  readonly requestedBy?: string
  /** Providers actually queried, in query order. */
  readonly providers: KnowledgeProviderName[]
  /** Providers a routing decision selected but that were unavailable. */
  readonly unavailable: KnowledgeProviderName[]
  /** Retrieved items, in query order. */
  readonly items: KnowledgeItem[]
  /** UTF-8 byte length of the rendered packet. */
  readonly bytes: number
  /** Whether byte bounding removed or shortened provider text. */
  readonly truncated: boolean
}

/** Caller-supplied inputs for one retrieval. */
export interface RetrieveOptions {
  /** Enclosing tool execution for nested provider dispatch. */
  readonly execution?: Pick<ToolExecution, 'token' | 'rootCallId'>
  /** Providers to query; omitted routes the task automatically. */
  readonly providers?: readonly KnowledgeProviderName[]
  /** Caller identity recorded on the packet for source references. */
  readonly requestedBy?: string
  /** Caller whose scope the registry is read in; omitted reads the global view. */
  readonly agent?: Agent
  /** Cancellation for every provider query this retrieval dispatches. */
  readonly signal: AbortSignal
}

export type { MemorixCell, MemorixPage, MemorixTable } from './memorix-types.ts'
