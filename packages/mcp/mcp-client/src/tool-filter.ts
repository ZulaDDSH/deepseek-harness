/**
 * Static MCP tool filtering resolved once per connection configuration.
 *
 * @module @deepseek-ai/dsh-mcp-client/tool-filter
 */

/** Raw-name filter applied to one MCP server's discovered tool catalog. */
export interface ToolFilterConfig {
  /** Non-empty raw-name allow list; an omitted or empty list leaves tools unrestricted before deny filtering. */
  allow?: string[]
  /** Raw MCP tool names excluded after the optional allow list is applied. */
  deny?: string[]
}

/** Detached immutable filter used by repeated tool-list synchronizations. */
export interface ResolvedToolFilter {
  readonly allow?: readonly string[]
  readonly deny: readonly string[]
}

/**
 * Resolve and validate one static raw-name filter.
 * @param config - optional caller-authored raw-name filter.
 * @param path - configuration path used in diagnostics.
 * @returns a detached immutable filter for repeated discovery synchronizations.
 */
export function resolveToolFilter(
  config: ToolFilterConfig | undefined,
  path: string,
): ResolvedToolFilter {
  if (config === undefined) return Object.freeze({ deny: Object.freeze([]) })
  const keys = new Set(['allow', 'deny'])
  for (const key of Object.keys(config)) {
    if (!keys.has(key)) throw new Error(`${path}.${key} is not a tool filter option`)
  }
  const configuredAllow = resolveNames(config.allow, `${path}.allow`)
  const allow = configuredAllow?.length === 0 ? undefined : configuredAllow
  const deny = resolveNames(config.deny, `${path}.deny`)
  return Object.freeze({
    ...(allow === undefined ? {} : { allow }),
    deny: deny ?? Object.freeze([]),
  })
}

/**
 * Decide whether one raw MCP tool name survives the resolved filter.
 * @param filter - resolved filter, or undefined for allow-all behavior.
 * @param rawName - raw MCP tool name supplied by the server.
 * @returns whether the tool may register.
 */
export function toolAllowed(filter: ResolvedToolFilter | undefined, rawName: string): boolean {
  if (filter === undefined) return true
  return (filter.allow === undefined || filter.allow.includes(rawName))
    && !filter.deny.includes(rawName)
}

function resolveNames(names: unknown, path: string): readonly string[] | undefined {
  if (names === undefined) return undefined
  if (!Array.isArray(names)) throw new Error(`${path} must be an array`)
  const seen = new Set<string>()
  const resolved = names.map((name, index) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`${path}[${index}] must be a non-empty string`)
    }
    if (seen.has(name)) throw new Error(`${path} contains duplicate tool name "${name}"`)
    seen.add(name)
    return name
  })
  return Object.freeze(resolved)
}
