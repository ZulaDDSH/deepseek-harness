/**
 * Three shared tools adapt model arguments to scoped resource operations.
 *
 * @module @deepseek-ai/dsh-mcp-resources
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { McpResourceRequest } from './index.ts'
import { renderResourceResult } from './render.ts'

type RequestResource = (server: string, request: McpResourceRequest, exec: ToolExecution) => Promise<JsonValue>

const listParameters = {
  server: { type: 'string', required: true, description: 'Configured MCP server name.' },
  cursor: { type: 'string', description: 'Continuation cursor returned by this server.' },
} as const

const output = {
  schema: { type: 'json' } as const,
  render: (args: { server: string }, value: JsonValue) => renderResourceResult(args.server, value),
}

const RESOURCE_TOO_LARGE = 'MCP_RESOURCE_TOO_LARGE'

// Constraint: matched by code string; this package must not import the MCP client.
function explainTooLarge(error: unknown): never {
  if (error instanceof Error && (error as { code?: unknown }).code === RESOURCE_TOO_LARGE) {
    throw new Error(`${error.message}. The server's content cannot be read in full through read_mcp_resource and a retry returns the same result; use another resource or a narrower URI.`, { cause: error })
  }
  throw error
}

/**
 * Register resource operations in the consumer's tool scope.
 * @param ctx - context owning the tool registrations.
 * @param request - caller-aware resource operation.
 * @returns the effect disposer that removes all three tools synchronously.
 */
export function registerResourceTools(ctx: Context, request: RequestResource): () => void {
  // All three tools are read-only and parallel-safe; `McpResourceProvider.request` settles concurrent requests independently.
  const dispose = ctx.effect(function* () {
    yield ctx.tools.register(defineTool({
      name: 'list_mcp_resources',
      description: 'List resources available from an MCP server.',
      parameters: listParameters,
      output,
      isConcurrencySafe: () => true,
      execute: (args, exec) => request(args.server, {
        method: 'resources/list', ...args.cursor === undefined ? {} : { cursor: args.cursor },
      }, exec),
    }))
    yield ctx.tools.register(defineTool({
      name: 'list_mcp_resource_templates',
      description: 'List parameterized resource URI templates from an MCP server.',
      parameters: listParameters,
      output,
      isConcurrencySafe: () => true,
      execute: (args, exec) => request(args.server, {
        method: 'resources/templates/list', ...args.cursor === undefined ? {} : { cursor: args.cursor },
      }, exec),
    }))
    yield ctx.tools.register(defineTool({
      name: 'read_mcp_resource',
      description: 'Read an MCP resource by URI from the named server. Use a listed URI or an expanded resource template.',
      parameters: {
        server: listParameters.server,
        uri: { type: 'string', required: true, description: 'Resource URI to read.' },
      },
      output,
      isConcurrencySafe: () => true,
      execute: (args, exec) => request(args.server, { method: 'resources/read', uri: args.uri }, exec).catch(explainTooLarge),
    }))
  }, 'mcpResources.resourceTools')
  // oxlint-disable-next-line typescript/no-misused-promises -- all collected tool disposers are synchronous
  return dispose
}
