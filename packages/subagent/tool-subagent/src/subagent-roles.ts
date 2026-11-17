import type { Context } from '@deepseek-ai/cordis'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { effectiveSubagentSetupOf } from '@deepseek-ai/dsh-api-session-controller/setup-resolver'
import { LlmError, ReasoningEffortId, errorChain, isHarnessError } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { hasDelegationModelRequest } from './model-selection.ts'
import type { DelegationModelRequest } from './model-selection.ts'

/** Delegation roles a child can run as; `orchestrator` is the session model and is not delegated. */
export const DELEGATION_ROLES = ['coder', 'reviewer', 'researcher'] as const

/** Provider that runs Claude-subscription role routes. */
export const CLAUDE_CLI_PROVIDER = 'claude-code'

/** Model-facing delegation arguments that may carry a role. */
export interface DelegationRoleRequest extends DelegationModelRequest {
  /** Orchestrator & Subagent Setup role whose route the child runs on; validated against {@link DELEGATION_ROLES}. */
  readonly role?: string
}

/** Child route resolved from a fixed Orchestrator & Subagent Setup role. */
export interface RoleRoute {
  /** Route backend: a host LLM provider or the Claude CLI provider. */
  readonly kind: 'llm' | 'claude-cli'
  /** Agent options that pin the child route. */
  readonly options: AgentOptions
}

/**
 * Resolve the Orchestrator & Subagent Setup route for a delegation role.
 * @param ctx - Context that owns the sessions, projections and subagent registry.
 * @param session - Calling Session; its setup is read here or from an ancestor.
 * @param request - Model-facing arguments; `role` selects the route.
 * @param claudeCliProvider - Provider name that runs Claude-subscription routes.
 * @returns The pinned route, or undefined for a Jev-decides role or a role-less call that Orchestrator & Subagent Setup does not govern.
 * @throws When Orchestrator & Subagent Setup is on with a configured role and the call omits `role` or names a route beside it.
 */
export function roleRouteOf(
  ctx: Context,
  session: Session,
  request: DelegationRoleRequest,
  claudeCliProvider: string,
): RoleRoute | undefined {
  const { role } = request
  const setup = effectiveSubagentSetupOf(ctx, session)
  const configured = setup?.enabled === true ? DELEGATION_ROLES.filter(candidate => setup.roles[candidate] !== undefined) : []
  if (role === undefined) {
    if (configured.length > 0) {
      throw new Error(`Orchestrator & Subagent Setup is on, so every subagent call must pass role (${configured.join(', ')}); a call without one is rejected because the child would run on your own model`)
    }
    if (hasDelegationModelRequest(request) && setup?.enabled === true) {
      throw new Error(`Orchestrator & Subagent Setup is on, so pass role (${DELEGATION_ROLES.join(', ')}) instead of provider, model, or reasoning_effort`)
    }
    return undefined
  }
  const delegated = DELEGATION_ROLES.find(candidate => candidate === role)
  if (delegated === undefined) throw new Error(`subagent role must be one of ${DELEGATION_ROLES.join(', ')}`)
  if (hasDelegationModelRequest(request)) {
    throw new Error(`subagent role "${role}" chooses the child route; omit provider, model, and reasoning_effort${configured.length === 0 ? '' : ` (configured roles: ${configured.join(', ')})`}`)
  }
  if (setup === undefined || !setup.enabled) {
    throw new Error(`subagent role "${role}" needs Orchestrator & Subagent Setup, which is off for this session`)
  }
  const setting = setup.roles[delegated]
  if (setting === undefined) {
    throw new Error(`subagent role "${role}" has no model in Orchestrator & Subagent Setup${configured.length === 0 ? '' : `; configured roles: ${configured.join(', ')}`}`)
  }
  if (setting.mode === 'jev') return undefined
  const { route } = setting
  const reasoningEffort = route.reasoningEffort === undefined
    ? {}
    : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) }
  if (route.backend === 'llm') {
    return { kind: 'llm', options: { provider: route.provider, model: route.model, ...reasoningEffort } }
  }
  const claude = ctx.subagents.getProvider(claudeCliProvider)
  if (claude === undefined || !claude.capabilities.agentOptions) {
    throw new Error(`subagent role "${role}" runs on a Claude subscription, but provider "${claudeCliProvider}" is not installed or takes no per-run model`)
  }
  return { kind: 'claude-cli', options: { model: route.model, ...reasoningEffort } }
}

/**
 * Name the role and its route on a failed child-route preflight, so the parent sees the fix before any child starts.
 * @param role - Requested delegation role.
 * @param route - Effective child route the preflight resolved for that role.
 * @param error - Failure the LLM runtime raised for the route.
 * @param signal - Call signal; an aborted call is not a route failure.
 * @returns A tool error naming role, provider, model and fix; `error` unchanged without a role or after an abort.
 */
export function roleRouteFailure(role: string | undefined, route: AgentOptions | undefined, error: unknown, signal: AbortSignal): unknown {
  if (role === undefined || signal.aborted) return error
  const fix = isHarnessError(error) && error.code === 'MISSING_CREDENTIAL'
    ? 'pick another route in Orchestrator & Subagent Setup or add a key in Settings'
    : 'pick another route in Orchestrator & Subagent Setup'
  return new Error(
    `subagent role "${role}" is set to ${route?.provider ?? '(inherited provider)'}/${route?.model ?? '(inherited model)'}, which cannot run: `
    + `${errorChain(error)}; ${fix}`,
  )
}

/**
 * Refuse a role route whose provider has no configured credential, before any child Session is created.
 * @param ctx - Context that owns the Session controller's credential state.
 * @param role - Requested delegation role.
 * @param route - Effective child route the preflight resolved for that role.
 * @param signal - Call signal, forwarded to {@link roleRouteFailure}.
 * @throws A tool error naming role, provider, model and the fix when the route's credential is missing.
 */
export async function assertRoleRouteCredential(
  ctx: Context,
  role: string | undefined,
  route: AgentOptions | undefined,
  signal: AbortSignal,
): Promise<void> {
  if (role === undefined || route?.provider === undefined) return
  const missing = await ctx.get('sessionController')?.missingCredentialProviders()
  if (missing?.includes(route.provider) !== true) return
  throw roleRouteFailure(role, route, new LlmError(`no credential is configured for provider "${route.provider}"`, 'MISSING_CREDENTIAL'), signal)
}

/**
 * Reject a delegation tool that cannot run Orchestrator & Subagent Setup roles while the setup governs the Session.
 * @param ctx - Context that owns the sessions and projections.
 * @param session - Calling Session; its setup is read here or from an ancestor.
 * @param toolName - Name of the rejected tool, for the error.
 * @throws When Orchestrator & Subagent Setup is on with at least one configured delegation role.
 */
export function assertRolelessToolAllowed(ctx: Context, session: Session, toolName: string): void {
  const setup = effectiveSubagentSetupOf(ctx, session)
  const configured = setup?.enabled === true ? DELEGATION_ROLES.filter(candidate => setup.roles[candidate] !== undefined) : []
  if (configured.length > 0) {
    throw new Error(`Orchestrator & Subagent Setup is on, so ${toolName} is unavailable; use the subagent tool with role (${configured.join(', ')})`)
  }
}
