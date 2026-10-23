/** Pure Subagent Setup draft helpers: catalog defaults and role choice encoding. */
import type {
  SubagentRoleRoute, SubagentRoleSetting, SubagentSetup, SubagentSetupRole,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { SUBAGENT_SETUP_ROLES } from './contract.ts'
import type { ModelCatalogModel, ModelProviderGroup, SessionRunOptions } from '@deepseek-ai/dsh-api-session-controller/types'

/** One routable catalog model: its provider group id plus the model. */
export interface CatalogRoute {
  readonly provider: string
  readonly model: ModelCatalogModel
}

/** Select value that clears a role. */
export const NONE_CHOICE = 'none'
/** Select value that leaves a role to Jev routing. */
export const JEV_CHOICE = 'jev'
/** Select value for the Claude Code subscription backend. */
export const CLAUDE_CHOICE = 'claude'

/** Review rounds a new setup starts with. */
export const DEFAULT_REVIEW_ROUNDS = 2

const CODER_HINT = /haiku|flash|mini|chat/iu
const REVIEWER_HINT = /opus|pro|reasoner|sonnet/iu

/**
 * Flatten provider groups into catalog routes in catalog order.
 * @param groups - provider groups from the live catalog.
 * @returns every model with its provider id.
 */
export function catalogRoutesOf(groups: readonly ModelProviderGroup[]): readonly CatalogRoute[] {
  return groups.flatMap(group => group.models.map(model => ({ provider: group.id, model })))
}

function pick(routes: readonly CatalogRoute[], hint: RegExp): CatalogRoute | undefined {
  return routes.find(route => hint.test(route.model.id) || hint.test(route.model.name)) ?? routes[0]
}

function llmRoute(route: CatalogRoute, reasoningEffort?: string): SubagentRoleRoute {
  return {
    backend: 'llm',
    provider: route.provider,
    model: route.model.id,
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  }
}

/**
 * Default roles: Claude Haiku and Opus (Sonnet without Opus) when the Claude CLI backend is installed, else catalog name heuristics.
 * The orchestrator is Jev-routed and researcher stays unset.
 * @param groups - routable provider groups of the live catalog.
 * @param claudeAvailable - whether the Claude CLI role backend is installed.
 * @returns the default role settings.
 */
export function defaultRolesFor(groups: readonly ModelProviderGroup[], claudeAvailable = false): SubagentSetup['roles'] {
  if (claudeAvailable) {
    const anthropic = groups.find(group => group.id === 'anthropic')
    const opus = anthropic === undefined || anthropic.models.some(model => /opus/iu.test(model.id) || /opus/iu.test(model.name))
    return {
      orchestrator: { mode: 'jev' },
      coder: { mode: 'fixed', route: { backend: 'claude-cli', model: 'haiku' } },
      reviewer: { mode: 'fixed', route: { backend: 'claude-cli', model: opus ? 'opus' : 'sonnet', reasoningEffort: 'high' } },
    }
  }
  const routes = catalogRoutesOf(groups)
  const coder = pick(routes, CODER_HINT)
  const reviewer = pick(routes, REVIEWER_HINT)
  const reviewEffort = reviewer?.model.reasoning?.efforts.some(level => level.id === 'high') === true ? 'high' : undefined
  return {
    orchestrator: { mode: 'jev' },
    ...coder === undefined ? {} : { coder: { mode: 'fixed', route: llmRoute(coder) } },
    ...reviewer === undefined ? {} : { reviewer: { mode: 'fixed', route: llmRoute(reviewer, reviewEffort) } },
  }
}

/**
 * Encode one role setting as the picker's select value.
 * @param setting - the role's saved setting, when configured.
 * @returns the select value naming its choice.
 */
export function choiceOf(setting: SubagentRoleSetting | undefined): string {
  if (setting === undefined) return NONE_CHOICE
  if (setting.mode === 'jev') return JEV_CHOICE
  return setting.route.backend === 'claude-cli'
    ? CLAUDE_CHOICE
    : JSON.stringify([setting.route.provider, setting.route.model])
}

/**
 * Decode a picked select value into the role setting it names.
 * @param choice - the select value picked.
 * @param previous - the role's current setting, kept for the Claude model text.
 * @returns the new role setting, or undefined when the role is cleared.
 */
export function settingOf(choice: string, previous: SubagentRoleSetting | undefined): SubagentRoleSetting | undefined {
  if (choice === NONE_CHOICE) return undefined
  if (choice === JEV_CHOICE) return { mode: 'jev' }
  if (choice === CLAUDE_CHOICE) {
    const model = previous?.mode === 'fixed' && previous.route.backend === 'claude-cli' ? previous.route.model : ''
    return { mode: 'fixed', route: { backend: 'claude-cli', model } }
  }
  const [provider, model] = JSON.parse(choice) as [string, string]
  return { mode: 'fixed', route: { backend: 'llm', provider, model } }
}

/**
 * Replace one role in a draft setup without touching the others.
 * @param setup - the draft to change.
 * @param role - the role to replace.
 * @param setting - the new setting, or undefined to clear the role.
 * @returns a new draft setup.
 */
export function withRole(setup: SubagentSetup, role: SubagentSetupRole, setting: SubagentRoleSetting | undefined): SubagentSetup {
  const roles: Partial<Record<SubagentSetupRole, SubagentRoleSetting>> = {}
  for (const entry of SUBAGENT_SETUP_ROLES) {
    const next = entry === role ? setting : setup.roles[entry]
    if (next !== undefined) roles[entry] = next
  }
  return { ...setup, roles }
}

/**
 * Pick one value from a fixed option list.
 * @param options - the allowed values.
 * @param value - the picked select value.
 * @returns the matching option, or undefined when the value is not one of them.
 */
export function optionOf<T extends string>(options: readonly T[], value: string): T | undefined {
  return options.find(option => option === value)
}

/**
 * Drop the subagent setup from one run-options write, keeping the other run options.
 * @param options - the Session's current run options.
 * @returns the run options without an override, so the Session inherits the global default.
 */
export function withoutSubagentSetup(options: SessionRunOptions): SessionRunOptions {
  return {
    ...options.fastMode === undefined ? {} : { fastMode: options.fastMode },
    ...options.ultracode === undefined ? {} : { ultracode: options.ultracode },
    ...options.effort === undefined ? {} : { effort: options.effort },
  }
}

/**
 * Name the roles fixed to Claude Code whose model is empty or blank, in display order.
 * @param setup - the setup to check.
 * @returns the roles that run on Claude Code without a model; empty when every Claude Code role names one.
 */
export function claudeRolesMissingModel(setup: SubagentSetup): readonly SubagentSetupRole[] {
  return SUBAGENT_SETUP_ROLES.filter((role) => {
    const setting = setup.roles[role]
    return setting?.mode === 'fixed' && setting.route.backend === 'claude-cli' && setting.route.model.trim() === ''
  })
}

/**
 * Accept a stored global default only when it is shaped like a Subagent Setup and no Claude Code role lacks a model.
 * @param value - the value read from the global settings section.
 * @returns the setup, or undefined when the stored value is absent, not shaped like one, or leaves a Claude Code role without a model.
 */
export function subagentSetupOrUndefined(value: unknown): SubagentSetup | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<SubagentSetup>
  const roles: unknown = Reflect.get(value, 'roles')
  if (typeof candidate.enabled !== 'boolean' || typeof candidate.reviewRounds !== 'number'
    || typeof roles !== 'object' || roles === null || candidate.roles === undefined) return undefined
  const blankClaudeModel = Object.values(candidate.roles).some((setting: unknown) => {
    const route: unknown = typeof setting === 'object' && setting !== null ? Reflect.get(setting, 'route') : undefined
    if (typeof route !== 'object' || route === null || Reflect.get(route, 'backend') !== 'claude-cli') return false
    const model: unknown = Reflect.get(route, 'model')
    return typeof model !== 'string' || model.trim() === ''
  })
  return blankClaudeModel ? undefined : candidate as SubagentSetup
}
