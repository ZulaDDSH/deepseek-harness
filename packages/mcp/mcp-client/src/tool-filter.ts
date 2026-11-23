export interface ToolFilterConfig {
  allow?: string[]
  deny?: string[]
}

export interface ResolvedToolFilter {
  readonly allow?: readonly string[]
  readonly deny: readonly string[]
}

export function resolveToolFilter(config: ToolFilterConfig | undefined, path: string): ResolvedToolFilter {
  if (config === undefined) return Object.freeze({ deny: Object.freeze([]) })
  for (const key of Object.keys(config)) {
    if (key !== 'allow' && key !== 'deny') throw new Error(`${path}.${key} is not a tool filter option`)
  }
  const allow = resolveNames(config.allow, `${path}.allow`)
  const deny = resolveNames(config.deny, `${path}.deny`) ?? Object.freeze([])
  return Object.freeze({ ...(allow === undefined || allow.length === 0 ? {} : { allow }), deny })
}

export function toolAllowed(filter: ResolvedToolFilter | undefined, rawName: string): boolean {
  return filter === undefined || (filter.allow === undefined || filter.allow.includes(rawName)) && !filter.deny.includes(rawName)
}

function resolveNames(names: unknown, path: string): readonly string[] | undefined {
  if (names === undefined) return undefined
  if (!Array.isArray(names)) throw new Error(`${path} must be an array`)
  const seen = new Set<string>()
  const result = names.map((name, index) => {
    if (typeof name !== 'string' || name.length === 0) throw new Error(`${path}[${index}] must be a non-empty string`)
    if (seen.has(name)) throw new Error(`${path} contains duplicate tool name "${name}"`)
    seen.add(name)
    return name
  })
  return Object.freeze(result)
}
