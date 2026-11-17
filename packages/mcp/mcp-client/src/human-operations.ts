/** @module Host-owned operations on a connected global MCP server. */
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { scopeOf } from '@deepseek-ai/dsh-scope'

/** Connected provider access for explicit human actions, never a model dispatch. */
export interface McpHumanOperations {
  /** Whether the provider is a locally launched stdio process. */
  readonly local: boolean
  /** Configured working directory used by the provider. */
  readonly cwd: string
  /** Explicit provider environment, retained on the Host and never forwarded to a browser. */
  readonly env: Readonly<Record<string, string>>
  /**
   * Call a discovered, permitted provider tool with schema validation.
   * @param name - raw upstream tool name.
   * @param args - parsed JSON arguments for the human action.
   * @param signal - caller cancellation combined with the connection lifetime.
   * @returns the raw MCP result.
   */
  call(name: string, args: Record<string, JsonValue>, signal: AbortSignal): Promise<unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Resolve one global provider for a Host-owned human operation.
     * @mode waterfall
     * @param server - configured server name.
     * @param next - delegation to other configured providers.
     */
    'mcp/human-operations'(server: string, next: () => Promise<McpHumanOperations | undefined>): Promise<McpHumanOperations | undefined>
  }
}

/**
 * Register connection-owned human access while keeping Agent-scoped servers private.
 * @param ctx - connection's effect owner.
 * @param server - configured server name.
 * @param operations - current-generation provider access.
 */
export function registerHumanOperations(ctx: Context, server: string, operations: McpHumanOperations): void {
  if (scopeOf(ctx) !== undefined) return
  ctx.on('mcp/human-operations', async (requested, next) => requested === server ? operations : next())
}
