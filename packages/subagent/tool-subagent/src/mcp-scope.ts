import type { Context } from '@deepseek-ai/cordis'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'

/**
 * Whether children of this provider get per-call MCP scoping. Forked children
 * keep the parent's tools so the inherited prefix stays cache-reusable.
 * @param provider - the mounted subagent provider.
 * @returns true when MCP tools are scoped per call.
 */
export function scopesMcp(provider: SubagentProvider): boolean {
  return provider.capabilities.toolFilter === true && !provider.inheritsParentContext
}

/**
 * The `mcp` parameter, offered only where {@link scopesMcp} holds.
 * @param provider - the mounted subagent provider.
 * @returns the parameter entry, or none.
 */
export function mcpParameter(provider: SubagentProvider): { mcp?: { type: 'array'; items: { type: 'string' }; description: string } } {
  return scopesMcp(provider)
    ? {
      mcp: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'MCP servers the child may use: the `<server>` part of `mcp__<server>__<tool>` names. Omit to give the child no MCP tools, which keeps it much cheaper; name only the servers the task needs.',
      },
    }
    : {}
}

/**
 * Add a deny entry for every MCP tool whose server the call did not request.
 * @param ctx - context whose global tool registry is read.
 * @param configured - the deployment's configured child tool filter.
 * @param scoped - whether this child's MCP tools are scoped at all.
 * @param args - the tool call arguments; `mcp` names the servers the child keeps.
 * @returns the request's `toolFilter` field, or none.
 */
export function scopedToolFilter(
  ctx: Context,
  configured: ToolRestriction | undefined,
  scoped: boolean,
  args: { mcp?: readonly string[] },
): { toolFilter?: ToolRestriction } {
  const keep = new Set(args.mcp)
  const deny = !scoped ? [] : (ctx.get('tools')?.schemas() ?? []).map(schema => schema.name).filter((name) => {
    const rest = name.startsWith('mcp__') ? name.slice(5) : ''
    const separator = rest.indexOf('__')
    return separator > 0 && !keep.has(rest.slice(0, separator))
  })
  const filter = deny.length === 0 ? configured : { ...configured, deny: [...configured?.deny ?? [], ...deny] }
  return filter === undefined ? {} : { toolFilter: filter }
}
