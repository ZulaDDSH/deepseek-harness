/**
 * Profile-named Claude Code one-shot subagent provider. Every accepted run
 * invokes the official Agent SDK in the delegating Session's workspace and
 * places the SDK-spawned real CLI under the shared subprocess owner.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code
 */

import type { AgentDefinition, PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { claudeCliUltracodeSupported, ultracodeSupported } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
// Type-only: make `ctx.sessionProjections` resolve and the per-Session `runOptions` key typed.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import {
  assertPositiveFinite,
  NO_START_CAPABILITIES,
  parentAgentOptionsForDelegation,
  resolveParentSandboxMode,
  type ParentSandboxMode,
  assertUsableCwd,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import {
  CLAUDE_CODE_PERMISSION_MODES,
  DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
  claudeCodeStartupFailure,
  startClaudeCodeRun,
  type ClaudeCodePermissionMode,
  type ClaudeCodeRunSpec,
} from './run.ts'
import { claudeCodeRunOptionsProjection, inheritedRunOptions } from './run-options-projection.ts'
import { ANTHROPIC_ROUTE, withApiCreditsKey } from './api-credits.ts'
import { claudeRunSelectionOf } from './run-selection.ts'

export const name = 'subagent-claude-code'
export const inject = ['subagents', 'subprocess', 'sessionProjections']

const DEFAULT_PROVIDER_NAME = 'claude-code'

/* jscpd:ignore-start -- sibling product providers intentionally expose
 * overlapping deployment-owned fields without adding a shared config owner. */
/** Deployment-owned model, permission, environment, and process-release settings. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `claude-code`). */
  providerName?: string
  /** Native Claude model fixed for this instance; omitted to inherit Claude settings. */
  model?: string
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /**
   * Native non-interactive mode fixed for this Provider instance. Defaults to
   * `dontAsk`; `acceptEdits` accepts edits, `auto` uses the native classifier,
   * `plan` returns a plan without approving execution, and
   * `bypassPermissions` explicitly skips permission checks.
   */
  permissionMode?: ClaudeCodePermissionMode
  /**
   * Profile default for native ultracode (standing Workflow-tool orchestration
   * with workflows enabled), applied only to runs whose model is a current Claude 5 family model;
   * the delegating Session's Ultracode level overrides it for that run.
   * A run on any other model, or on a model Claude Code picks itself, sends
   * no ultracode setting.
   */
  ultracode?: Volatile<boolean | undefined>
  /** Native custom subagents, keyed by agent name, that each run can invoke through Claude Code's Agent tool. */
  agents?: Record<string, AgentDefinition>
  /** Grace in milliseconds between Claude Code managed-range termination tiers. */
  disposeGraceMs?: number
  /**
   * Wall-clock limit in milliseconds for one published run; expiry cancels it and
   * settles as an error with category `limit`. It does not bound SDK startup.
   */
  timeoutMs?: number
  /** Native turn limit passed to the SDK `maxTurns` option. */
  maxTurns?: number
  /** Native spend limit in USD passed to the SDK `maxBudgetUsd` option. */
  maxBudgetUsd?: number
}

// schemastery runs a transform callback on the stripped result and on the raw input; the raw pass sees unknown keys.
function exactObject(fields: Record<string, z>) {
  const known = new Set(Object.keys(fields))
  return z.transform(z.object(fields), (value) => {
    for (const key of Object.keys(value)) {
      if (!known.has(key)) throw new Error(`unknown key "${key}"; expected ${[...known].join(', ')}`)
    }
    return value
  })
}

const mcpRemoteServerFields = {
  url: z.string().min(1).required(),
  headers: z.dict(z.string()).default(undefined as never),
  tools: z.array(exactObject({
    name: z.string().min(1).required(),
    permission_policy: z.union(['always_allow', 'always_ask', 'always_deny']).default(undefined as never),
    org_max_permission: z.union(['allow', 'ask', 'blocked']).default(undefined as never),
  })).default(undefined as never),
  timeout: z.number(),
  alwaysLoad: z.boolean(),
}

// `sdk` servers are rejected: this provider registers no in-process MCP servers for them to name.
const mcpServerSchema = z.union([
  exactObject({
    type: z.const('stdio'),
    command: z.string().min(1).required(),
    args: z.array(z.string()).default(undefined as never),
    env: z.dict(z.string()).default(undefined as never),
    timeout: z.number(),
    alwaysLoad: z.boolean(),
  }),
  exactObject({ type: z.const('sse').required(), ...mcpRemoteServerFields }),
  exactObject({ type: z.const('http').required(), ...mcpRemoteServerFields }),
])

// Omitted fields must stay absent: schemastery's [] and {} defaults would reach the SDK as real values.
const agentDefinitionSchema = z.object({
  description: z.string().min(1).required(),
  prompt: z.string().min(1).required(),
  criticalSystemReminder_EXPERIMENTAL: z.string(),
  tools: z.array(z.string()).default(undefined as never),
  disallowedTools: z.array(z.string()).default(undefined as never),
  model: z.string().min(1),
  mcpServers: z.array(z.union([z.string().min(1), z.dict(mcpServerSchema)])).default(undefined as never),
  skills: z.array(z.string()).default(undefined as never),
  initialPrompt: z.string(),
  maxTurns: z.natural().min(1),
  autoCompactWindow: z.natural().min(1),
  background: z.boolean(),
  omitClaudeMd: z.boolean(),
  memory: z.union(['user', 'project', 'local']),
  effort: z.union([z.union(['low', 'medium', 'high', 'xhigh', 'max']), z.number()]),
  permissionMode: z.union([...CLAUDE_CODE_PERMISSION_MODES]),
  observer: z.string(),
  observerMessage: z.string(),
})

export const Config = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  model: z.string().min(1),
  env: z.dict(z.string()).default({}),
  permissionMode: z.union([...CLAUDE_CODE_PERMISSION_MODES])
    .default(DEFAULT_CLAUDE_CODE_PERMISSION_MODE),
  ultracode: z.boolean().volatile(),
  agents: z.dict(agentDefinitionSchema).default(undefined as never) as z<Record<string, AgentDefinition>>,
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  timeoutMs: z.number(),
  maxTurns: z.natural().min(1),
  maxBudgetUsd: z.number(),
})

type ResolvedConfig = Omit<Required<Config>, 'model' | 'ultracode' | 'agents' | 'timeoutMs' | 'maxTurns' | 'maxBudgetUsd'> & Pick<Config, 'model' | 'ultracode' | 'agents' | 'timeoutMs' | 'maxTurns' | 'maxBudgetUsd'>

/**
 * Narrow a permission mode to what the delegating parent's file sandbox allows.
 * @param configured - the Profile-fixed mode, provider-level or per agent.
 * @param parentSandbox - the parent Session's resolved sandbox mode, or `undefined` when unconfined.
 * @returns the narrowed mode.
 */
function sandboxedPermissionMode<Mode extends PermissionMode>(
  configured: Mode,
  parentSandbox: ParentSandboxMode | undefined,
): Mode | 'plan' | 'acceptEdits' {
  if (parentSandbox === 'read-only') return 'plan'
  if (parentSandbox === 'workspace-write' && (configured === 'bypassPermissions' || configured === 'auto')) return 'acceptEdits'
  return configured
}

/**
 * Clamp each Profile-fixed native agent's permission mode to the parent sandbox.
 * @param agents - the Profile-fixed native agents.
 * @param parentSandbox - the parent Session's resolved sandbox mode.
 * @returns agents with each `permissionMode` clamped.
 */
function sandboxedAgents(
  agents: Record<string, AgentDefinition>,
  parentSandbox: ParentSandboxMode | undefined,
): Record<string, AgentDefinition> {
  return Object.fromEntries(Object.entries(agents).map(([agentName, agent]): [string, AgentDefinition] => [
    agentName,
    agent.permissionMode === undefined
      ? agent
      : { ...agent, permissionMode: sandboxedPermissionMode(agent.permissionMode, parentSandbox) },
  ]))
}

/**
 * Name each native agent whose permission mode the parent sandbox narrowed.
 * @param configured - the Profile-fixed native agents before clamping.
 * @param clamped - the same agents after {@link sandboxedAgents}.
 * @returns one note per narrowed agent, empty when nothing changed.
 */
function narrowedAgentNotes(
  configured: Record<string, AgentDefinition>,
  clamped: Record<string, AgentDefinition>,
): string[] {
  return Object.entries(clamped).flatMap(([agentName, agent]) => {
    const before = configured[agentName]?.permissionMode
    return before === undefined || agent.permissionMode === undefined || before === agent.permissionMode
      ? []
      : [`agent ${agentName} permission mode narrowed from ${before} to ${agent.permissionMode}`]
  })
}
/* jscpd:ignore-end */

/* jscpd:ignore-start -- Cordis registration and shared-seam plumbing mirror
 * the Codex sibling; each product's lifecycle remains package-private. */
class ClaudeCodeProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = { ...NO_START_CAPABILITIES, agentOptions: true }
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  async start(request: ResolvedSubagentStartRequest) {
    let cwd: string
    try {
      cwd = assertUsableCwd('subagent-claude-code', 'child cwd', request.cwd)
    } catch (error: unknown) {
      if (request.signal.aborted) {
        throw new Error(
          'subagent-claude-code: request was aborted before SDK startup',
        )
      }
      const failure = claudeCodeStartupFailure(error)
      this.ctx.logger.warn(
        `subagent-claude-code "${this.name}": child start failed: %o`,
        failure,
      )
      throw failure
    }
    const parentSandbox = resolveParentSandboxMode(this.ctx, request.parent.session)
    const permissionMode = sandboxedPermissionMode(this.config.permissionMode, parentSandbox)
    const agents = this.config.agents === undefined
      ? undefined
      : sandboxedAgents(this.config.agents, parentSandbox)
    const providerNote = permissionMode === this.config.permissionMode
      ? []
      : [`Claude Code permission mode narrowed from ${this.config.permissionMode} to ${permissionMode} by the parent session's ${String(parentSandbox)} sandbox`]
    const agentNotes = this.config.agents === undefined || agents === undefined
      ? []
      : narrowedAgentNotes(this.config.agents, agents)
    const notes = [...providerNote, ...agentNotes]
    const sandboxNote = notes.length === 0 ? undefined : notes.join('; ')
    if (sandboxNote !== undefined) {
      this.ctx.logger.info(`subagent-claude-code "${this.name}": ${sandboxNote}`)
    }
    const runOptions = inheritedRunOptions(
      request.parent.session,
      session => this.ctx.sessionProjections.snapshot(session, ['runOptions']).values.runOptions?.current,
      id => this.ctx.get('sessions')?.get(id),
    )
    const selection = claudeRunSelectionOf(request.agentOptions)
    const model = selection.model ?? this.config.model
    const parentModel = parentAgentOptionsForDelegation(request.parent).model
    const staleUltracode = runOptions?.ultracode === true && !(parentModel !== undefined && ultracodeSupported(parentModel))
    const sessionUltracode = staleUltracode ? undefined : runOptions?.ultracode
    const ultracode = model !== undefined && claudeCliUltracodeSupported(model)
      ? sessionUltracode ?? this.config.ultracode?.get()
      : undefined
    const effort = selection.effort ?? runOptions?.effort
    const spec: ClaudeCodeRunSpec = {
      cwd,
      ...model === undefined ? {} : { model },
      permissionMode,
      ...ultracode === undefined ? {} : { ultracode },
      ...runOptions?.fastMode === undefined ? {} : { fastMode: runOptions.fastMode },
      ...effort === undefined ? {} : { effort },
      ...agents === undefined ? {} : { agents },
      ...sandboxNote === undefined ? {} : { sandboxNote },
      ...this.config.timeoutMs === undefined ? {} : { timeoutMs: this.config.timeoutMs },
      ...this.config.maxTurns === undefined ? {} : { maxTurns: this.config.maxTurns },
      ...this.config.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: this.config.maxBudgetUsd },
      env: await withApiCreditsKey(this.ctx, this.config.env),
      disposeGraceMs: this.config.disposeGraceMs,
      onRateLimit: (info) => {
        if (info.rateLimitType === undefined) return
        this.ctx.emit('llm/rate-limit-observed', {
          route: ANTHROPIC_ROUTE,
          window: info.rateLimitType,
          ...info.utilization === undefined ? {} : { utilization: info.utilization },
          ...info.resetsAt === undefined ? {} : { resetAt: info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt },
          status: info.status,
          observedAt: Date.now(),
        })
      },
      spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
      onError: (error, stopReason) => {
        this.ctx.logger.warn(
          `subagent-claude-code "${this.name}": child run failed (${stopReason}): %o`,
          error,
        )
      },
    }
    return startClaudeCodeRun(request, spec)
  }
}

/**
 * Register one Profile-named Claude Code provider.
 * @param ctx - context carrying shared subagent and subprocess services.
 * @param config - registry name, optional model, permission mode, ultracode, native custom agents, child environment, and disposal grace.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    ...config.model === undefined ? {} : { model: config.model },
    env: config.env as Record<string, string>,
    permissionMode: config.permissionMode ?? DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
    ...config.ultracode === undefined ? {} : { ultracode: config.ultracode },
    ...config.agents === undefined ? {} : { agents: config.agents },
    ...config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs },
    ...config.maxTurns === undefined ? {} : { maxTurns: config.maxTurns },
    ...config.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: config.maxBudgetUsd },
    disposeGraceMs: config.disposeGraceMs as number,
  }
  assertPositiveFinite(
    'subagent-claude-code',
    'disposeGraceMs',
    resolved.disposeGraceMs,
  )
  if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `subagent-claude-code: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  if (resolved.timeoutMs !== undefined) {
    assertPositiveFinite('subagent-claude-code', 'timeoutMs', resolved.timeoutMs)
    if (resolved.timeoutMs > MAX_TIMER_DELAY_MS) {
      throw new Error(
        `subagent-claude-code: timeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
      )
    }
  }
  if (resolved.maxBudgetUsd !== undefined) {
    assertPositiveFinite('subagent-claude-code', 'maxBudgetUsd', resolved.maxBudgetUsd)
  }
  void ctx.sessionProjections.register(claudeCodeRunOptionsProjection)
  ctx.subagents.registerProvider(new ClaudeCodeProvider(
    resolved.providerName,
    ctx,
    resolved,
  ))
}
/* jscpd:ignore-end */
