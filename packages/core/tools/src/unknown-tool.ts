/**
 * Unknown-tool failure and near-name suggestions for the tool registry.
 * @module @deepseek-ai/dsh-tools/unknown-tool
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

const MAX_SUGGESTIONS = 5

/**
 * Thrown (internally) when the model requests a tool that isn't registered.
 * Extends {@link HarnessError} (`code: 'UNKNOWN_TOOL'`) so an unknown-tool
 * failure is as routable as a tool-thrown one — retry/sandbox/replay code can
 * distinguish it from a tool body's own error.
 */
export class ToolNotFoundError extends HarnessError {
  /**
   * @param toolName - the name the caller asked for.
   * @param reachableFrom - detail appended after the name: how the model reaches
   *   a visible tool instead, or a near-name or disconnected-server hint from
   *   {@link unknownToolHint}. Omitted when there is no detail to give.
   */
  constructor(toolName: string, reachableFrom?: string) {
    super(
      reachableFrom === undefined
        ? `unknown tool "${toolName}"`
        : `unknown tool "${toolName}": ${reachableFrom}`,
      'UNKNOWN_TOOL',
    )
    this.name = 'ToolNotFoundError'
  }
}

function mcpServer(name: string): string | undefined {
  return /^mcp__(.+?)__/.exec(name)?.[1]
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      /* v8 ignore next -- rows hold b.length + 1 cells, so every index below is in range */
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost))
    }
    previous = current
  }
  /* v8 ignore next -- the final row always holds b.length + 1 cells */
  return previous[b.length] ?? 0
}

/**
 * Detail for an unknown-tool message: the visible names nearest `name`, or why its MCP server offers none.
 * @param name - the requested tool name.
 * @param visible - names visible to the calling scope.
 * @returns the detail to append, or `undefined` when nothing is close.
 */
export function unknownToolHint(name: string, visible: Iterable<string>): string | undefined {
  const names = [...visible]
  const server = mcpServer(name)
  if (server !== undefined && !names.some(n => mcpServer(n) === server)) {
    return `MCP server "${server}" has no available tools (disconnected?)`
  }
  const wanted = name.toLowerCase()
  const limit = Math.max(2, Math.floor(wanted.length / 3))
  const ranked = names.map((candidate) => {
    const lower = candidate.toLowerCase()
    return {
      candidate,
      same: server !== undefined && mcpServer(candidate) === server,
      distance: editDistance(wanted, lower),
      contains: Math.min(lower.length, wanted.length) >= 3 && (lower.includes(wanted) || wanted.includes(lower)),
    }
  }).filter(r => r.same || r.contains || r.distance <= limit)
    .sort((a, b) => Number(b.same) - Number(a.same) || a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, MAX_SUGGESTIONS)
  return ranked.length === 0 ? undefined : `did you mean ${ranked.map(r => r.candidate).join(', ')}?`
}
