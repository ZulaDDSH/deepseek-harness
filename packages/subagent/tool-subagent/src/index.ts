/**
 * Model-facing delegation through one configured `ctx.subagents` provider.
 * Provider lifecycle controls tool registration and context-sensitive schema
 * wording. Foreground calls wait for the child's result and release it.
 * Background policy is selected by this plugin's configuration: one-shot calls
 * run as a Job, while continuable calls return the durable child id and the
 * runtime delivers its settlement notice.
 * @module @deepseek-ai/dsh-tool-subagent
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  assertSubagentMaxDepth,
  delegationDepthOf,
  parentAgentOptionsForDelegation,
} from '@deepseek-ai/dsh-subagent'
import type { SubagentActivation, SubagentProvider, SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import {
  assertAllowedModelSelection,
  hasConfiguredLlmSelection,
  hasDelegationModelRequest,
  preflightChildLlmRoute,
  requestedAgentOptions,
} from './model-selection.ts'
import type { AllowedModelRoute } from './model-selection.ts'
import { registerListSubagentModels } from './list-models.ts'
import { SubagentPresetSelection, type PresetSelectionConfig, type PresetSelectionRequest } from './preset-selection.ts'
import { cannotDelegate, restrictAtDepthLimit } from './depth-limit.ts'
import { mcpParameter, scopedToolFilter, scopesMcp } from './mcp-scope.ts'
import {
  CLAUDE_CLI_PROVIDER, DELEGATION_ROLES, assertRoleRouteCredential, assertRolelessToolAllowed, roleRouteFailure, roleRouteOf,
} from './subagent-roles.ts'
import type { DelegationRoleRequest } from './subagent-roles.ts'

export { CLAUDE_CLI_PROVIDER, roleRouteOf } from './subagent-roles.ts'
import type {} from './model-selection-settings.ts'
import {
  subagentModelSelectionProjectionDefinition,
  subagentModelSelectionPolicy,
} from './model-selection-state.ts'

export const name = 'tool-subagent'
export const inject = ['tools', 'subagents', 'systemPrompt', 'sessionProjections']

// Definition identity keeps shared guidance scoped to the actual visible tools,
// including scoped overrides and independently loaded tool registries.
const delegationTools = new Set<ToolDefinition>()

/** Config: which registered provider this tool delegates to, plus child defaults. */
export interface Config extends PresetSelectionConfig {
  /** The `ctx.subagents` provider name to start runs on (e.g. `spawn`, `acp`). */
  provider: string
  /**
   * Model-facing tool name (default `subagent`). Each loaded instance must use
   * a distinct name.
   */
  toolName?: string
  /**
   * Expose optional child `provider`, `model`, and `reasoning_effort` fields.
   * Requires provider `agentOptions` support. Execution enforces the Session
   * policy, or restricts explicit selection to the current parent route.
   */
  modelSelection?: boolean
  /**
   * Register the shared `list_subagent_models` tool for this scope.
   * Enable on only one instance per scope; defaults to false and does not
   * enable model selection. Discovery is removed when this instance unloads.
   */
  modelDiscovery?: boolean
  /**
   * Sample the Host `subagent-model-selection` setting for each new top-level
   * Session and inherit that decision in its child Sessions. Route fields and
   * discovery then appear only where that decision enables them.
   */
  modelSelectionSettings?: boolean
  /**
   * Expose `run_in_background` (default true). Disabled instances omit the
   * parameter and reject forced background calls.
   */
  enableRunInBackground?: boolean
  /**
   * Background execution policy (default `one-shot`). `one-shot` defaults calls
   * to foreground; `continuable` defaults them to background, requires a provider
   * with the `prepareContinuable` capability, and returns the durable child id.
   */
  backgroundMode?: 'one-shot' | 'continuable'
  /**
   * Agent options applied to every child; omitted fields use child-loop defaults.
   */
  agentOptions?: AgentOptions
  /**
   * Per-child persona that shadows `deployment:persona-prefix`. Requires the
   * provider's `persona` capability; omission preserves the deployment persona.
   */
  persona?: string
  /**
   * Tool filter applied to every child. Filtered tools disappear from its
   * prompt and reject execution. Requires the provider's `toolFilter`
   * capability; unknown names fail startup.
   */
  toolFilter?: {
    /** Global tool names the child keeps; everything else is removed. */
    allow?: string[]
    /** Global tool names removed from the child. */
    deny?: string[]
  } | undefined
  /**
   * Maximum child depth: a non-negative safe integer (`0` forbids delegation),
   * or `'provider-managed'` to send no cap. A numeric cap requires the
   * provider's `depthLimit` capability (mount fails loud otherwise), hides the
   * tool from agents whose child would exceed it, and the provider checks the
   * calling agent's current depth at every start. `'provider-managed'` is for
   * an out-of-process provider whose recursion budget belongs to the child
   * runtime or its own deployment. Omission reads the current Host subagent
   * depth setting (default `1`) at each delegation.
   */
  maxDepth?: number | 'provider-managed'
  /** Accept the `role` argument and run roles from Orchestrator & Subagent Setup (default `false`). */
  roles?: boolean
  /** Provider that runs Claude-subscription roles (default `claude-code`). */
  claudeCliProvider?: string
}

export const Config: z<Config> = z.object({
  provider: z.string().required(),
  toolName: z.string().default('subagent'),
  modelSelection: z.boolean().default(false),
  modelDiscovery: z.boolean().default(false),
  modelSelectionSettings: z.boolean().default(false),
  enableRunInBackground: z.boolean().default(true),
  backgroundMode: z.union(['one-shot', 'continuable'] as const).default('one-shot'),
  // Prevent Schemastery from materializing omitted agentOptions as `{}`.
  agentOptions: z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string().min(1) as z<ReturnType<typeof ReasoningEffortId> | undefined>,
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  }).default(undefined as unknown as {
    provider: string
    model: string
    reasoningEffort: ReturnType<typeof ReasoningEffortId>
    maxTokens: number
  }),
  persona: z.string(),
  // Preserve omission; Schemastery's `{ allow: [] }` default would deny every tool.
  toolFilter: (z.object({
    allow: (z.array(z.string()) as z<string[] | undefined>).default(undefined),
    deny: (z.array(z.string()) as z<string[] | undefined>).default(undefined),
  }) as z<{ allow?: string[]; deny?: string[] } | undefined>).default(undefined),
  agentPreset: z.string().min(1),
  allowedAgentPresets: (z.array(z.string().min(1)).min(1) as z<string[] | undefined>).default(undefined),
  maxDepth: z.union([z.natural().max(Number.MAX_SAFE_INTEGER), z.const('provider-managed' as const)]),
  roles: z.boolean().default(false),
  claudeCliProvider: z.string().default(CLAUDE_CLI_PROVIDER),
})

/** Render text blocks from the canonical JSON block array without trusting arbitrary values. */
function outputValueText(values: JsonValue[]): string {
  return values
    .filter((value): value is { type: 'text'; text: string } =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
      && value.type === 'text' && typeof value.text === 'string')
    .map(value => value.text)
    .join('')
}

/** Flatten a child's final output blocks to the task's final text. */
function finalText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Render a failed stop reason with optional provider-authored detail. */
function failureDetail(result: SubagentResult): string {
  const stopReason = result.stopReason
  return result.diagnostic === undefined
    ? stopReason
    : `${stopReason}; diagnostic: ${result.diagnostic}`
}

/**
 * Map a child result to the task outcome: completed carries final text, local
 * cancellation (`aborted` without a diagnostic) is killed, and provider-
 * diagnosed remote aborts plus every other reason are failed without partial
 * output.
 * @param result - child terminal result.
 * @returns outcome for the `ctx.jobs` registration.
 */
function runOutcome(result: SubagentResult): JobOutcome {
  switch (result.stopReason) {
    case 'completed':
      return { status: 'completed', result: finalText(result.output) }
    case 'aborted':
      return result.diagnostic === undefined
        ? { status: 'killed' }
        : { status: 'failed', detail: failureDetail(result) }
    case 'error':
    case 'max-tokens':
    case 'refusal':
      return { status: 'failed', detail: failureDetail(result) }
    // Merge-extensible union: a backend may add stop reasons. Keep unknown
    // terminal reasons as failures with provider-authored detail.
    default:
      return { status: 'failed', detail: failureDetail(result) }
  }
}

/**
 * Await one background activation's result, then release it. Result and
 * disposal failures become `failed`; when both fail, both details survive.
 * @param activation - the started activation to settle and release.
 * @returns outcome after child resources are released.
 */
async function settleRun(activation: SubagentActivation): Promise<JobOutcome> {
  let outcome: JobOutcome
  try {
    outcome = runOutcome(await activation.result)
  } catch (error: unknown) {
    outcome = { status: 'failed', detail: String(error) }
  }
  try {
    await activation.dispose()
  } catch (error: unknown) {
    const prefix = outcome.detail === undefined ? '' : `${outcome.detail}; `
    return { status: 'failed', detail: `${prefix}dispose failed: ${String(error)}` }
  }
  return outcome
}

/** Settle pending startup without rejecting the task producer contract. */
async function settleStart(start: Promise<SubagentActivation>, signal: AbortSignal): Promise<JobOutcome> {
  let activation: SubagentActivation
  try {
    activation = await start
  } catch (error: unknown) {
    // Product providers aggregate startup and rollback failures. Cancellation
    // must not turn a failed cleanup into a cleanly killed Job.
    return signal.aborted && !(error instanceof AggregateError)
      ? { status: 'killed' }
      : { status: 'failed', detail: String(error) }
  }
  return settleRun(activation)
}

/** A non-`completed` stop reason means the child did not finish cleanly. */
function stopReasonError(result: SubagentResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'aborted':
      return 'subagent run was cancelled'
    case 'error':
      return 'subagent run failed'
    case 'max-tokens':
      return 'subagent run hit its token limit before finishing'
    case 'refusal':
      return 'subagent declined the task'
    // Merge-extensible union: a backend may add stop reasons. Treat an unknown
    // terminal reason as a failure rather than reporting partial output as success.
    default:
      return `subagent run ended abnormally (${String(result.stopReason)})`
  }
}

/**
 * Append provider-authored failure detail and the child's preserved partial
 * answer to a stop-reason error, keeping diagnostic text separate from the
 * child's assistant output.
 * @param error - the stop-reason headline.
 * @param result - the child's terminal result.
 * @returns the headline, diagnostic, and partial text that are present.
 */
function withDiagnosticAndPartialText(error: string, result: SubagentResult): string {
  const diagnostic = result.diagnostic === undefined
    ? ''
    : `\nDiagnostic: ${result.diagnostic}`
  const text = result.output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
  const partial = text.length === 0
    ? ''
    : `\nPartial output before the run ended:\n${text}`
  return `${error}${diagnostic}${partial}`
}

type ForegroundToolResult = {
  readonly kind: 'foreground'
  readonly runId: SessionId
  readonly output: JsonValue[]
}

/**
 * Collect and release one foreground activation. A caller abort disposes the
 * exact activation, and disposal never replaces an independent result failure.
 */
async function settleForegroundRun(started: SubagentActivation, signal: AbortSignal): Promise<ForegroundToolResult> {
  const stop = (): void => { void started.dispose().catch(() => undefined) }
  signal.addEventListener('abort', stop, { once: true })
  const [execution] = await Promise.allSettled([
    started.result.then((result): ForegroundToolResult => {
      const error = stopReasonError(result)
      if (error !== undefined) {
        // The registry converts this throw to isError; partial output is not
        // success, but the preserved partial answer still reaches the parent.
        throw new Error(withDiagnosticAndPartialText(error, result))
      }
      return {
        kind: 'foreground',
        runId: started.childId,
        // Content blocks already cross durable JSON boundaries elsewhere;
        // the registry performs the authoritative lossless snapshot here.
        output: result.output as never,
      }
    }),
  ])
  signal.removeEventListener('abort', stop)
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => started.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/**
 * Model-facing wording from the provider's conversation-history descriptor
 * ({@link SubagentProvider.inheritsParentContext}).
 * A fresh child needs a standalone prompt; a forked child already sees the
 * conversation's completed turns — telling the model to restate everything
 * (or, worse, that the child "does not see this conversation") would be false
 * for a fork.
 * @param inheritsConversation - whether the child's conversation is seeded
 *   with the parent's completed turns; this says nothing about tool, service,
 *   scope, or authority inheritance.
 * @returns the tool `description` and the `prompt` parameter description.
 */
function providerWording(inheritsConversation: boolean): { description: string; promptDescription: string } {
  if (inheritsConversation) {
    return {
      description:
        'Delegate a task to a subagent that inherits this conversation: a child agent seeded with all '
        + 'completed turns so far (it does not see the current in-flight turn). Use this when the subtask '
        + 'builds on this conversation\'s context — a follow-up analysis, '
        + 'a review, a continuation — without consuming this conversation\'s context for the work itself. '
        + 'You receive its result, not its intermediate steps.',
      promptDescription:
        'The task for the subagent. It already sees this conversation\'s completed turns, so build on them '
        + 'freely and state only what is new.',
    }
  }
  return {
    description:
      'Delegate a self-contained task to a subagent (a separate agent that works in its own context) '
      + 'to offload focused, independent work — research, a scoped '
      + 'implementation, an analysis — so it does not consume this conversation\'s context. The subagent '
      + 'returns its result, not its intermediate steps.',
    promptDescription:
      'The complete, self-contained task for the subagent. It does not share this '
      + 'conversation\'s context, so include everything it needs.',
  }
}

interface DelegationRunRequest {
  readonly run_in_background?: boolean
}

interface DelegationRunSpec {
  readonly runInBackground: boolean
}

/** Resolve the model's optional scheduling request into one execution route. */
function resolveDelegationRun(
  request: DelegationRunRequest,
  options: { readonly backgroundEnabled: boolean; readonly continuable: boolean },
): DelegationRunSpec {
  if (!options.backgroundEnabled) {
    // The validator permits undeclared keys, so schema omission also needs
    // execution-time enforcement.
    if (request.run_in_background === true) {
      throw new Error('run_in_background is disabled for this tool instance (enableRunInBackground: false)')
    }
    return { runInBackground: false }
  }
  return {
    // Continuable work is independently scheduled unless the caller explicitly
    // needs the result before its next action. One-shot policy keeps its existing
    // foreground default because its background result requires Task collection.
    runInBackground: request.run_in_background ?? options.continuable,
  }
}

/**
 * Model-facing delegation-tool composition. Standing compositions install per
 * Agent when the Host model-selection setting applies; direct setups pass the
 * unpublished Session they will own.
 * @param ctx - Context that owns the registrations.
 * @param config - delegation-tool configuration.
 * @param session - unpublished Session supplied by a direct Agent setup; omit for a standing composition.
 * @returns when the plugin is ready.
 */
export async function apply(ctx: Context, config: Config, session?: Session): Promise<void> {
  // Direct apply() bypasses Schemastery's numeric constraints. A direct-apply
  // omission stays capless (the schema default only runs through the loader).
  if (config.maxDepth !== 'provider-managed') assertSubagentMaxDepth(config.maxDepth)
  // Reject an empty explicit filter at load instead of failing every delegation.
  if (config.toolFilter !== undefined && config.toolFilter.allow === undefined && config.toolFilter.deny === undefined) {
    throw new Error('tool-subagent: `toolFilter` is configured but names neither `allow` nor `deny` — remove the key or fill the filter')
  }
  const presets = new SubagentPresetSelection(config)
  if (presets.configured && ctx.get('agentPresets') === undefined) {
    throw new Error('tool-subagent: agent preset selection requires the agent-presets service')
  }
  const backgroundEnabled = config.enableRunInBackground !== false
  const continuable = (config.backgroundMode ?? 'one-shot') === 'continuable'
  const toolName = config.toolName ?? 'subagent'
  const claudeCliProvider = config.claudeCliProvider ?? CLAUDE_CLI_PROVIDER
  const modelSelectionCapable = config.modelSelection === true || config.modelSelectionSettings === true

  const subagentModelSelectionProjectionHandle = await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)

  const assertSubagentProviderConfiguration = (subagentProvider: SubagentProvider): void => {
    presets.assertProvider(subagentProvider)
    if (ctx.subagents.resolveMaxDepth(config.maxDepth) !== undefined && !subagentProvider.capabilities.depthLimit) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" cannot enforce maxDepth (no depthLimit capability) — `
        + 'set maxDepth: \'provider-managed\' to leave the recursion budget to the provider',
      )
    }
    if (config.agentOptions !== undefined && !subagentProvider.capabilities.agentOptions) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" does not support child agentOptions`,
      )
    }
    if (modelSelectionCapable && !subagentProvider.capabilities.agentOptions) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" does not support child model selection`,
      )
    }
    if (continuable && subagentProvider.prepareContinuable === undefined) {
      throw new Error(
        `tool-subagent: provider "${subagentProvider.name}" does not support \`backgroundMode: continuable\``,
      )
    }
  }

  // Validate provider-owned config outside the optional LLM binding so an
  // invalid provider always rejects its registration or this plugin's load.
  ctx.on('subagent/provider-added', (subagentProvider) => {
    if (subagentProvider.name === config.provider) assertSubagentProviderConfiguration(subagentProvider)
  })
  const initialProvider = ctx.subagents.getProvider(config.provider)
  if (initialProvider !== undefined) assertSubagentProviderConfiguration(initialProvider)

  const install = (runtimeCtx: Context, modelSelectionEnabled: boolean, discovery: boolean): void => {
    if (discovery) registerListSubagentModels(runtimeCtx, subagentModelSelectionProjectionHandle)
    // Load order and HMR replacement can change provider availability while
    // this fiber remains active.
    let mounted: { subagentProvider: SubagentProvider; definition: ToolDefinition; disposeTool: () => void } | undefined
    const mount = (subagentProvider: SubagentProvider): void => {
      assertSubagentProviderConfiguration(subagentProvider)
      const wording = providerWording(subagentProvider.inheritsParentContext)
      const providerRouteDefaults = subagentProvider.agentRouteDefaults
      const selectionDescription = providerRouteDefaults !== undefined
        ? ' Supply `provider` and `model` together. Omitted values use child defaults, falling back to this backend\'s route defaults. When the effective route changes, an omitted `reasoning_effort` uses the model\'s default.'
        : ' Supply `provider` and `model` together. Omitted values use child defaults, falling back to compatible parent values. When the effective route changes, an omitted `reasoning_effort` uses the model\'s default.'
      const runMode = backgroundEnabled
        // The completion notice is the continuation service's own behavior, not
        // a separately installed capability, so this promise holds whenever the
        // continuable background path is reachable at all.
        ? continuable
          ? ' It runs in the background by default and returns a subagent id you can continue with `send_message`; you are notified when the run settles.'
          : ' This call waits for the result by default.'
        : ' This call waits for the subagent and returns its result.'
      const definition = defineTool({
        name: toolName,
        description: wording.description
          + runMode
          + (modelSelectionEnabled ? selectionDescription : '')
          + (modelSelectionEnabled && subagentProvider.inheritsParentContext
            ? ' Changing the route can prevent provider-side reuse of the inherited conversation prefix.'
            : ''),
        parameters: {
          cwd: {
            type: 'string',
            description: 'Initial child working directory. Relative paths use your current directory; omitted inherits it. Later directory changes in either agent are independent.',
          },
          description: {
            type: 'string',
            required: true,
            description: 'A short (3-5 word) description of the delegated task, for display.',
          },
          prompt: {
            type: 'string',
            required: true,
            description: wording.promptDescription,
          },
          ...presets.choices === undefined ? {} : {
            agent_preset: {
              type: 'string' as const,
              enum: [...presets.choices],
              description: presets.description,
            },
          },
          ...config.roles === true ? {
            role: {
              type: 'string' as const,
              enum: [...DELEGATION_ROLES],
              description: 'Run this child on the route Orchestrator & Subagent Setup configures for the role. Required while Orchestrator & Subagent Setup is on; omit provider, model, and reasoning_effort when you pass a role.',
            },
          } : {},
          ...modelSelectionEnabled ? {
            provider: {
              type: 'string' as const,
              description: 'Child LLM provider id.',
            },
            model: {
              type: 'string' as const,
              description: 'Model id within that provider.',
            },
            reasoning_effort: {
              type: 'string' as const,
              description: 'Model-specific reasoning effort id.',
            },
          } : {},
          ...backgroundEnabled ? {
            run_in_background: {
              type: 'boolean' as const,
              description: continuable
                ? 'Defaults to true. Set false only when your next action depends on the result.'
                : 'Run as a background job and return its id (collect with job_output, stop with job_kill). Defaults to false.',
            },
          } : {},
          ...mcpParameter(subagentProvider),
        },
        output: {
          schema: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'background' },
                  jobId: { type: 'string', required: true },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'continuable' },
                  subagentId: { type: 'string', required: true },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'foreground' },
                  runId: { type: 'string', required: true },
                  output: { type: 'array', required: true, items: { type: 'json' } },
                },
              },
            ],
          },
          render: (_args, value) => [{
            type: 'text',
            text: value.kind === 'background'
              ? `started background subagent job ${value.jobId}`
              : value.kind === 'continuable'
                ? `started subagent ${value.subagentId}`
                : outputValueText(value.output),
          }],
        },
        // Children never mutate the parent session; the one parent-owned write
        // (tasks.start) is a synchronous commutative insertion.
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          const parent = exec.agent
          if (!parent) {
            // Non-agent callers provide no parent for delegation ownership.
            throw new Error('subagent tool requires a calling agent (exec.agent was undefined)')
          }

          const routes = subagentModelSelectionPolicy(subagentModelSelectionProjectionHandle, parent.session)
          const modelSelectionPolicy = routes === undefined ? undefined : { routes }
          const agentPreset = presets.resolve(args as PresetSelectionRequest)
          const modelRequest = args as DelegationRoleRequest
          if (config.roles !== true && config.provider !== 'spawn') assertRolelessToolAllowed(runtimeCtx, parent.session, toolName)
          const pin = config.roles === true
            ? roleRouteOf(runtimeCtx, parent.session, modelRequest, claudeCliProvider)
            : undefined
          const parentOptions = parentAgentOptionsForDelegation(parent)
          const requiresRoutePreflight = pin?.kind === 'llm'
            || (pin === undefined && (hasDelegationModelRequest(modelRequest) || hasConfiguredLlmSelection(config.agentOptions)))
          const configuredChildAgentOptions = requiresRoutePreflight && providerRouteDefaults !== undefined
            ? { ...providerRouteDefaults, ...config.agentOptions }
            : config.agentOptions
          const requestedChildAgentOptions = pin?.options ?? requestedAgentOptions(
            parentOptions,
            configuredChildAgentOptions,
            modelRequest,
            modelSelectionEnabled,
          )
          if (pin === undefined) {
            assertAllowedModelSelection(
              modelSelectionPolicy,
              parentOptions,
              requestedChildAgentOptions,
              modelRequest,
            )
          }
          if (requiresRoutePreflight) {
            const llm = runtimeCtx.get('llm')
            if (llm === undefined) {
              throw new Error('cannot resolve the selected child LLM route because the `llm` service is unavailable')
            }
            await preflightChildLlmRoute(
              llm,
              parentOptions,
              requestedChildAgentOptions,
              exec.signal,
              pin === undefined && providerRouteDefaults === undefined,
            ).catch((error: unknown) => {
              throw pin === undefined ? error : roleRouteFailure(modelRequest.role, requestedChildAgentOptions, error, exec.signal)
            })
            if (pin?.kind === 'llm') {
              await assertRoleRouteCredential(runtimeCtx, modelRequest.role, requestedChildAgentOptions, exec.signal)
            }
            if (runtimeCtx.subagents.getProvider(config.provider) !== subagentProvider) {
              throw new Error(`subagent provider "${config.provider}" changed while resolving the child LLM route; retry the delegation`)
            }
          }
          exec.signal.throwIfAborted()
          const claudeCli = pin?.kind === 'claude-cli'
          const maxDepth = claudeCli ? undefined : runtimeCtx.subagents.resolveMaxDepth(config.maxDepth)
          const request = {
            ...args.cwd === undefined ? {} : { cwd: args.cwd },
            prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
            parent,
            ...agentPreset === undefined ? {} : { agentPreset },
            ...requestedChildAgentOptions !== undefined ? { agentOptions: requestedChildAgentOptions } : {},
            ...config.persona !== undefined ? { persona: config.persona } : {},
            ...scopedToolFilter(runtimeCtx, config.toolFilter, !claudeCli && scopesMcp(subagentProvider), args),
            ...maxDepth !== undefined ? { maxDepth } : {},
            ...pin === undefined ? {} : { routePinned: true as const },
          }

          const startProvider = claudeCli ? claudeCliProvider : config.provider
          const runContinuable = continuable && !claudeCli
          const runSpec = resolveDelegationRun(args, { backgroundEnabled, continuable: runContinuable })
          if (runSpec.runInBackground) {
            if (runContinuable) {
              // Resolves at inbox acceptance: the child owns its own turns from
              // there, so this call neither waits for nor collects a result.
              const started = await runtimeCtx.subagents.startActivation({
                provider: config.provider,
                label: args.description,
                request,
                signal: exec.signal,
                delivery: 'parent',
              })
              return { kind: 'continuable' as const, subagentId: started.childId }
            }
            const jobs = runtimeCtx.get('jobs')
            if (jobs === undefined) {
              throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
            }
            // One-shot background child: job preflight finishes before the
            // starter can spawn, and the task-owned signal covers startup.
            const id = jobs.start({
              kind: 'subagent',
              label: args.description,
              owner: parent.id,
              run: (job) => {
                const controller = new AbortController()
                const start = runtimeCtx.subagents.startActivation({
                  provider: startProvider,
                  label: args.description,
                  request: { ...request, onProgress: (line) => { job.updateProgress(line) } },
                  signal: controller.signal,
                  delivery: 'caller',
                })
                return {
                  cancel: (reason?: string) => {
                    controller.abort(reason ?? 'background subagent task killed')
                    // Startup cancellation rejects the start; a published activation is disposed exactly.
                    void start.then(activation => activation.dispose()).catch(() => undefined)
                  },
                  done: settleStart(start, controller.signal),
                }
              },
            })
            return { kind: 'background' as const, jobId: id }
          }

          const started = await runtimeCtx.subagents.startActivation({
            provider: startProvider,
            label: args.description,
            request,
            signal: exec.signal,
            delivery: 'caller',
          })
          return settleForegroundRun(started, exec.signal)
        },
      })
      const disposeTool = runtimeCtx.effect(() => {
        const unregister = runtimeCtx.tools.register(definition)
        delegationTools.add(definition)
        return () => {
          delegationTools.delete(definition)
          unregister()
        }
      })
      // oxlint-disable-next-line typescript/no-misused-promises -- Tool and guidance disposal are synchronous.
      mounted = { subagentProvider, definition, disposeTool }
    }

    // Register listeners before checking presence so no synchronous change is missed.
    // TODO(subagent-dup-toolname): two waiting one-shot fibers configured with the
    // same toolName collide when their provider appears, and the duplicate-name
    // throw rolls back the provider registration. Continuable instances reserve
    // their prompt-section name during apply() and fail earlier. Add an intent
    // registry if the late one-shot collision occurs in a shipped composition.
    runtimeCtx.on('subagent/provider-added', (subagentProvider) => {
      if (subagentProvider.name === config.provider && mounted === undefined) mount(subagentProvider)
    })
    runtimeCtx.on('subagent/provider-removed', (name) => {
      if (name !== config.provider || mounted === undefined) return
      mounted.disposeTool()
      mounted = undefined
    })
    const present = runtimeCtx.subagents.getProvider(config.provider)
    if (present !== undefined) {
      mount(present)
    } else {
      // A backend fiber may activate later; a misspelled provider remains visible in this log.
      runtimeCtx.logger.info(`subagent provider "${config.provider}" not registered yet; the "${config.toolName ?? 'subagent'}" tool will register when it appears`)
    }
    runtimeCtx.systemPrompt.section({
      name: `tool:${toolName}`,
      order: runtimeCtx.systemPrompt.getSectionOrder('TOOL_SUBAGENT'),
      text: (context) => {
        if (mounted === undefined) return ''
        const visible = [...delegationTools]
          .filter(tool => runtimeCtx.tools.get(tool.name, context.scope) === tool)
          .map(tool => tool.name)
          .sort()
        if (visible[0] !== toolName) return ''
        const names = visible.map(name => `\`${name}\``).join(' or ')
        return `Start independent delegations with ${names} together in one assistant message and continue useful work while they run. When only waiting for their results remains, end your turn instead of sleeping or polling; the next result starts a new turn.`
      },
    })
    runtimeCtx.systemPrompt.context({
      name: `tool:${toolName}:depth`,
      order: runtimeCtx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION'),
      text: (context) => {
        if (context.agent === undefined || mounted === undefined
          || runtimeCtx.tools.get(toolName, context.scope) !== mounted.definition) return ''
        const maxDepth = runtimeCtx.subagents.resolveMaxDepth(config.maxDepth)
        if (maxDepth === undefined) return ''
        const depth = delegationDepthOf(context.agent)
        if (depth < maxDepth) return ''
        return `Delegation depth for \`${toolName}\`: current ${depth}, maximum ${maxDepth}, remaining levels 0.`
          + ` Do not call \`${toolName}\` at this depth; carry out the work directly.`
      },
    })
  }

  if (config.modelSelectionSettings !== true) {
    restrictAtDepthLimit(ctx, toolName, config.maxDepth)
    install(ctx, config.modelSelection === true, config.modelDiscovery === true)
    return
  }

  const settings = ctx.get('subagentModelSelection')
  if (settings === undefined) {
    throw new Error(
      'tool-subagent: `modelSelectionSettings` requires '
      + '@deepseek-ai/dsh-tool-subagent/model-selection-settings in the Host scope',
    )
  }
  const selectForSession = (target: Session): AllowedModelRoute[] | undefined => {
    const freshSession = target.firstLiveSeq === 0
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      && target.eventAt(SessionSeq(0))?.type !== 'session/end-seed'
    let allowedModels = subagentModelSelectionPolicy(subagentModelSelectionProjectionHandle, target)
    if (allowedModels === undefined) {
      const parentId = target.header.origin === 'subagent'
        ? target.header.parentSession
        : undefined
      if (parentId !== undefined) {
        const sessions = ctx.get('sessions')
        if (sessions === undefined) {
          throw new Error('tool-subagent: child model-selection inheritance requires the Session registry')
        }
        const parent = sessions.get(parentId)
        allowedModels = parent === undefined
          ? undefined
          : subagentModelSelectionPolicy(subagentModelSelectionProjectionHandle, parent)
      } else if (freshSession) {
        const current = settings.current()
        allowedModels = current.enabled ? current.allowedModels : undefined
      }
    }
    if (allowedModels !== undefined && subagentModelSelectionPolicy(subagentModelSelectionProjectionHandle, target) === undefined) {
      target.append('subagent/model-selection-policy', { allowedModels: allowedModels.map(route => ({ ...route })) })
    }
    return allowedModels
  }

  if (session !== undefined) {
    const allowedModels = selectForSession(session)
    install(ctx, allowedModels !== undefined, allowedModels !== undefined && config.modelDiscovery === true)
    return
  }

  const compositionScope = scopeOf(ctx)
  if (compositionScope === undefined) {
    throw new Error('tool-subagent: standing `modelSelectionSettings` requires a scoped preset Context')
  }
  const agents = ctx.get('agents')
  /* v8 ignore next -- shipped preset compositions always include the Agent registry. */
  if (agents === undefined) throw new Error('tool-subagent: standing `modelSelectionSettings` requires the Agent registry')
  const scopedInstalls = new WeakMap<Agent, ReturnType<Context['inject']>>()
  const installing = new WeakSet<Agent>()
  const belongsToComposition = (candidate: Agent): boolean =>
    scopeChainOf(scopeOf(candidate.ctx)).includes(compositionScope)
  const installScoped = (candidate: Agent): ReturnType<Context['inject']> | undefined => {
    const existing = scopedInstalls.get(candidate)
    if (existing !== undefined) return existing
    if (installing.has(candidate) || cannotDelegate(ctx, config.maxDepth, candidate)) return
    // Reserve before the injected fiber runs: tool registration emits
    // `tools/change` synchronously, which re-enters the reconciliation below.
    installing.add(candidate)
    let fiber: ReturnType<Context['inject']>
    try {
      const allowedModels = selectForSession(candidate.session)
      fiber = candidate.ctx.inject(['tools', 'subagents', 'systemPrompt'], (runtimeCtx) => {
        install(runtimeCtx, allowedModels !== undefined, allowedModels !== undefined && config.modelDiscovery === true)
      })
    } finally {
      installing.delete(candidate)
    }
    scopedInstalls.set(candidate, fiber)
    return fiber
  }
  const removeScoped = (candidate: Agent): void => {
    const fiber = scopedInstalls.get(candidate)
    if (fiber === undefined) return
    scopedInstalls.delete(candidate)
    /* v8 ignore next 3 -- Cordis Fiber disposal contains registration cleanup failures; this is the final diagnostic sink. */
    void fiber.dispose().catch((error: unknown) => {
      ctx.logger.warn(`tool-subagent: failed to remove recomposed Agent "${candidate.id}" definitions: ${String(error)}`)
    })
  }
  const reconcileComposedAgents = (): void => {
    for (const candidate of agents.list()) {
      if (belongsToComposition(candidate)) installScoped(candidate)
      else removeScoped(candidate)
    }
  }
  // The preset-scoped listener admits descendant Agents and installs the
  // sampled tool definition in each Agent's own scope, so a later settings
  // change cannot mutate a live session.
  ctx.on('agent/created', async ({ agent: created }) => {
    await installScoped(created)
  })
  ctx.on('agent/disposed', ({ agent: disposed }) => { removeScoped(disposed) })
  // Reparenting an Agent between standing presets changes its inherited tool
  // set and emits `tools/change`; reconcile the Agent-owned override with the
  // new ancestry. Other registry changes are idempotent no-ops here.
  ctx.on('tools/change', reconcileComposedAgents)
  reconcileComposedAgents()
}
