const ULTRACODE_MODEL_IDS: ReadonlySet<string> = new Set([
  'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1',
])

const CLAUDE_CLI_ULTRACODE_ALIASES: ReadonlySet<string> = new Set([
  'opus', 'opus[1m]', 'sonnet', 'sonnet[1m]', 'haiku', 'haiku[1m]', 'fable', 'fable[1m]',
])

const CLAUDE_CLI_DATED_ID = /^(claude-(?:opus|sonnet|haiku)-5-5|claude-fable-5-1)-\d{8}$/

/**
 * Whether a model id supports Ultracode, the multi-agent workflow mode of the current Claude 5 family.
 * @param model - provider-owned model id, such as `claude-opus-5-5`; the same id is served by every route that lists it.
 * @returns true when the model id is declared with Ultracode.
 */
export function ultracodeSupported(model: string): boolean {
  return ULTRACODE_MODEL_IDS.has(model)
}

/**
 * Whether a Claude Code model, either a full id or a CLI alias, supports Ultracode.
 * @param model - the Claude CLI model id or alias a run names.
 * @returns true for a current Claude 5 family model, its dated id, or an alias that resolves to one.
 */
export function claudeCliUltracodeSupported(model: string): boolean {
  const dated = CLAUDE_CLI_DATED_ID.exec(model)
  return ultracodeSupported(dated?.[1] ?? model) || CLAUDE_CLI_ULTRACODE_ALIASES.has(model)
}
