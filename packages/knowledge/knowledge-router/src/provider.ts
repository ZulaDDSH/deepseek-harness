/** @module @deepseek-ai/dsh-knowledge-router/provider */

import type { KnowledgeProviderName, ProviderStatus } from './types.ts'

/** Namespace prefix every bridged MCP tool carries. */
const MCP_TOOL_PREFIX = 'mcp__'

/** Deployment-independent facts about one supported knowledge provider. */
export interface ProviderSpec {
  /** Raw MCP tool name this package dispatches retrieval through. */
  readonly queryTool: string
  /** Argument name that carries the free-text task. */
  readonly taskArgument: string
  /** What this provider answers, for capability reporting and prompts. */
  readonly capability: string
}

/** The supported providers, keyed by identity. */
export const PROVIDER_SPECS: Readonly<Record<KnowledgeProviderName, ProviderSpec>> = Object.freeze({
  gitnexus: {
    queryTool: 'query',
    taskArgument: 'search_query',
    capability: 'Code structure, call chains, execution flows, blast radius, and data or control flow',
  },
  graphify: {
    queryTool: 'query_graph',
    taskArgument: 'question',
    capability: 'Persisted lessons, corrections, dead ends, and stale learned knowledge',
  },
})

/** Provider identities in a stable order. */
export const PROVIDER_NAMES: readonly KnowledgeProviderName[] = Object.freeze(['gitnexus', 'graphify'])

/** One provider's configured MCP server name, or undefined when unconfigured. */
export type ProviderServerNames = Partial<Record<KnowledgeProviderName, string>>

/**
 * List one server's raw MCP tool names from the registry's model-facing schemas.
 * @param schemas - visible tool schemas, each carrying its registered public name.
 * @param serverName - configured MCP client `serverName`.
 * @returns Sorted raw tool names; empty when the server registered nothing.
 */
export function serverToolNames(
  schemas: readonly { readonly name: string }[],
  serverName: string,
): string[] {
  const prefix = `${MCP_TOOL_PREFIX}${serverName}__`
  return schemas
    .filter(schema => schema.name.startsWith(prefix))
    .map(schema => schema.name.slice(prefix.length))
    .sort()
}

/**
 * Resolve the registered public name of one raw MCP tool.
 *
 * The MCP client owns the public-name rule, including its normalization and
 * hash fallback, so this reads the name the registry actually holds rather than
 * rebuilding it from the server and raw names.
 *
 * @param schemas - visible tool schemas, each carrying its registered public name.
 * @param serverName - configured MCP client `serverName`.
 * @param rawName - the server's own tool name.
 * @returns The registered public name, or undefined when the server exposes no such tool.
 */
export function registeredToolName(
  schemas: readonly { readonly name: string }[],
  serverName: string,
  rawName: string,
): string | undefined {
  const prefix = `${MCP_TOOL_PREFIX}${serverName}__`
  return schemas.find(schema => schema.name.startsWith(prefix) && schema.name.slice(prefix.length) === rawName)?.name
}

/**
 * Resolve one provider's status from its configuration and the live registry.
 * @param provider - provider identity.
 * @param serverName - configured server name, or undefined when the provider is disabled.
 * @param schemas - visible tool schemas from the registry.
 * @returns The provider's status; a disabled provider reports no tools.
 */
export function providerStatus(
  provider: KnowledgeProviderName,
  serverName: string | undefined,
  schemas: readonly { readonly name: string }[],
): ProviderStatus {
  const enabled = serverName !== undefined
  const tools = enabled ? serverToolNames(schemas, serverName) : []
  return {
    provider,
    enabled,
    serverName: serverName ?? '',
    connected: enabled && tools.length > 0,
    tools,
  }
}

/**
 * Resolve every supported provider's status.
 * @param serverNames - configured server name per provider.
 * @param schemas - visible tool schemas from the registry.
 * @returns One status per supported provider, in {@link PROVIDER_NAMES} order.
 */
export function providerStatuses(
  serverNames: ProviderServerNames,
  schemas: readonly { readonly name: string }[],
): readonly ProviderStatus[] {
  return PROVIDER_NAMES.map(provider => providerStatus(provider, serverNames[provider], schemas))
}
