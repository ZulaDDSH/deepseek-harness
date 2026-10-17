/**
 * Parse Claude Code's event-to-matcher-group hook format into bridge-runnable groups.
 * Command and prompt hooks run; other hook types, and prompt hooks on SessionStart,
 * are returned as skipped so the bridge can warn. Plugin-root and project-directory
 * substitutions are applied to commands at parse time.
 * @module @deepseek-ai/dsh-hooks-claude-code/config
 */

import { matcherDiagnostic, type CommandHook } from '@deepseek-ai/dsh-hook-protocol'

const CLAUDE_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStart',
  'SubagentStop',
] as const

/** A prompt hook: its prompt text, plus its optional model, timeout in seconds, and continueOnBlock flag. */
export interface PromptHook {
  prompt: string
  model?: string
  timeoutSec?: number
  continueOnBlock?: boolean
}

/** A runnable hook: a command hook or a prompt hook. */
export type ClaudeHook = CommandHook | PromptHook

/** One matcher group: an optional matcher and the runnable hooks it selects. */
export interface ClaudeMatcherGroup {
  matcher?: string
  hooks: ClaudeHook[]
}

/** A parsed CC config: event name → its matcher groups (command and prompt hooks). */
export type ClaudeCodeHookConfig = Record<string, ClaudeMatcherGroup[]>

/** A skipped non-command hook, surfaced so the bridge can warn about it. */
export interface SkippedHook {
  event: string
  type: string
}

/** The outcome of parsing one config file: the runnable groups + what was skipped. */
export interface ParsedClaudeConfig {
  config: ClaudeCodeHookConfig
  skipped: SkippedHook[]
}

/** Substitution variables applied to each `command` string at parse time. */
export interface SubstitutionVars {
  /** Replaces `${CLAUDE_PLUGIN_ROOT}` — the plugin's root dir. */
  pluginRoot?: string
  /** Replaces `${CLAUDE_PROJECT_DIR}` — the project root. */
  projectDir?: string
}

/** A plain (non-null, non-array) object, else undefined. */
function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Apply `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` substitution to a command string.
 * @param command - the raw command from config.
 * @param vars - the substitution values; a token whose variable is unset stays verbatim.
 * @returns the command with every occurrence of each set token replaced.
 */
export function substituteCommand(command: string, vars: SubstitutionVars): string {
  let out = command
  if (vars.pluginRoot !== undefined) out = out.split('${CLAUDE_PLUGIN_ROOT}').join(vars.pluginRoot)
  if (vars.projectDir !== undefined) out = out.split('${CLAUDE_PROJECT_DIR}').join(vars.projectDir)
  return out
}

/**
 * Parse either a settings `hooks` value or a bare `hooks.json` event map. Malformed entries are
 * ignored rather than failing boot; unsupported events are ignored before their groups are parsed,
 * hooks of other types and prompt hooks on SessionStart are returned in `skipped`, and substitutions
 * are applied to every surviving command. Matcher fields on UserPromptSubmit and Stop are discarded because those events have no
 * matcher subject. A matcher-bearing supported runnable group with an invalid regex throws a
 * `SyntaxError`, allowing the bridge to reject the complete config before listener registration.
 *
 * @param raw - the parsed JSON config: a settings object with a `hooks` key, or the bare
 *   event map.
 * @param vars - substitution values applied to every surviving `command` (defaults to
 *   none).
 * @returns the runnable per-event groups plus the skipped non-command hooks.
 */
export function parseClaudeCodeConfig(raw: unknown, vars: SubstitutionVars = {}): ParsedClaudeConfig {
  const config: ClaudeCodeHookConfig = {}
  const skipped: SkippedHook[] = []
  // Accept either `{ hooks: { … } }` (a settings file) or the bare event map.
  const root = asObject(raw)
  const hooksMap = root ? asObject(root.hooks) ?? root : undefined
  if (!hooksMap) return { config, skipped }

  for (const event of CLAUDE_EVENTS) {
    const rawGroups = hooksMap[event]
    if (!Array.isArray(rawGroups)) continue
    const groups: ClaudeMatcherGroup[] = []
    for (const rawGroup of rawGroups) {
      const group = asObject(rawGroup)
      if (!group || !Array.isArray(group.hooks)) continue
      const runnable: ClaudeHook[] = []
      for (const rawHook of group.hooks) {
        const hook = asObject(rawHook)
        if (!hook) continue
        const type = typeof hook.type === 'string' ? hook.type : 'command'
        if (type === 'prompt' && event !== 'SessionStart') {
          if (typeof hook.prompt !== 'string') continue
          runnable.push({
            prompt: hook.prompt,
            ...typeof hook.model === 'string' ? { model: hook.model } : {},
            ...typeof hook.timeout === 'number' ? { timeoutSec: hook.timeout } : {},
            ...typeof hook.continueOnBlock === 'boolean' ? { continueOnBlock: hook.continueOnBlock } : {},
          })
          continue
        }
        if (type !== 'command') {
          skipped.push({ event, type })
          continue
        }
        if (typeof hook.command !== 'string') continue
        runnable.push({
          command: substituteCommand(hook.command, vars),
          ...typeof hook.timeout === 'number' ? { timeoutSec: hook.timeout } : {},
        })
      }
      if (runnable.length === 0) continue
      const matcher = event === 'UserPromptSubmit' || event === 'Stop'
        ? undefined
        : typeof group.matcher === 'string' ? group.matcher : undefined
      const diagnostic = matcherDiagnostic(matcher, 'claude-code')
      if (diagnostic !== undefined) throw new SyntaxError(`${diagnostic} on event ${JSON.stringify(event)}`)
      groups.push({
        ...matcher !== undefined ? { matcher } : {},
        hooks: runnable,
      })
    }
    if (groups.length > 0) config[event] = groups
  }

  return { config, skipped }
}
