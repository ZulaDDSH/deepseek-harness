/**
 * Profile-named Claude Code one-shot subagent provider. Every accepted run
 * invokes the official Agent SDK in the delegating Session's workspace and
 * places the SDK-spawned real CLI under the shared subprocess owner.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code
 */

import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  assertPositiveFinite,
  NO_START_CAPABILITIES,
  resolveChildCwd,
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

export const name = 'subagent-claude-code'
export const inject = ['subagents', 'subprocess']

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
   * Turns on native ultracode (standing Workflow-tool orchestration with
   * workflows enabled) for every run; defaults to `false`. Workflow is
   * pre-approved only in `dontAsk` and `acceptEdits` modes. Requires a Claude
   * account or plan with workflows and a model that supports ultracode.
   */
  ultracode?: boolean
  /** Native custom subagents, keyed by agent name, that each run can invoke through Claude Code's Agent tool. */
  agents?: Record<string, AgentDefinition>
  /** Grace in milliseconds between Claude Code managed-range termination tiers. */
  disposeGraceMs?: number
}

// Omitted fields must stay absent: schemastery's [] and {} defaults would reach the SDK as real values.
const agentDefinitionSchema = z.object({
  description: z.string().min(1).required(),
  prompt: z.string().min(1).required(),
  criticalSystemReminder_EXPERIMENTAL: z.string(),
  tools: z.array(z.string()).default(undefined as never),
  disallowedTools: z.array(z.string()).default(undefined as never),
  model: z.string().min(1),
  mcpServers: z.array(z.union([z.string(), z.dict(z.any())])).default(undefined as never),
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

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  model: z.string().min(1),
  env: z.dict(z.string()).default({}),
  permissionMode: z.union([...CLAUDE_CODE_PERMISSION_MODES])
    .default(DEFAULT_CLAUDE_CODE_PERMISSION_MODE),
  ultracode: z.boolean().default(false),
  agents: z.dict(agentDefinitionSchema).default(undefined as never) as z<Record<string, AgentDefinition>>,
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

type ResolvedConfig = Omit<Required<Config>, 'model' | 'agents'> & Pick<Config, 'model' | 'agents'>
/* jscpd:ignore-end */

/* jscpd:ignore-start -- Cordis registration and shared-seam plumbing mirror
 * the Codex sibling; each product's lifecycle remains package-private. */
class ClaudeCodeProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  async start(request: ResolvedSubagentStartRequest) {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error(
        'subagent-claude-code: no working directory for the child — delegate from a parent session that has one',
      )
    }
    let cwd: string
    try {
      cwd = resolveChildCwd(
        'subagent-claude-code',
        undefined,
        parentCwd,
      )
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
    const spec: ClaudeCodeRunSpec = {
      cwd,
      ...this.config.model === undefined ? {} : { model: this.config.model },
      permissionMode: this.config.permissionMode,
      ultracode: this.config.ultracode,
      ...this.config.agents === undefined ? {} : { agents: this.config.agents },
      env: this.config.env,
      disposeGraceMs: this.config.disposeGraceMs,
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
    ultracode: config.ultracode ?? false,
    ...config.agents === undefined ? {} : { agents: config.agents },
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
  ctx.subagents.registerProvider(new ClaudeCodeProvider(
    resolved.providerName,
    ctx,
    resolved,
  ))
}
/* jscpd:ignore-end */
