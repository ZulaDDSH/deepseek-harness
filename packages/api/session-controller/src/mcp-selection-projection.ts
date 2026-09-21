/** Durable per-Session MCP connector selection projection. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { McpSelection, McpSelectionProjection, McpSelectionProjectionState } from './types.ts'

const selectionSchema = z.object({
  connectorIds: z.array(z.string().min(1)).readonly(),
}) as unknown as z.ZodType<McpSelection>

const stateSchema = z.object({ current: selectionSchema.nullable() }) as unknown as z.ZodType<McpSelectionProjectionState>
const viewSchema = z.object({ current: selectionSchema.nullable() }) as unknown as z.ZodType<McpSelectionProjection>

const mcpSelectionProjection = {
  key: 'mcpSelection',
  stateSchema,
  init: () => ({ current: null }),
  apply: (state, event: SessionEvent) => event.type === 'mcp/selection'
    ? { current: { connectorIds: [...new Set(event.data.connectorIds)].sort() } }
    : state,
  wire: {
    viewSchema,
    view: state => ({ current: state.current }),
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'mcpSelection', McpSelectionProjectionState>

/**
 * Register the MCP selection projection for Session Controller consumers.
 * @param ctx - application context that owns the Session projection registry.
 */
export function installMcpSelectionProjection(ctx: Context): void {
  ctx.sessionProjections.register(mcpSelectionProjection)
}
