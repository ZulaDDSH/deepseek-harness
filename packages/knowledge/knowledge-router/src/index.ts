/** @module @deepseek-ai/dsh-knowledge-router */

import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { assertSupervisor } from './authority.ts'
import { registerKnowledgeCommand } from './command.ts'
import { registerGraphifyCommand, type GraphifyCommandConfig } from './graphify-command.ts'
import { gitnexusFreshness, parseStaleness } from './gitnexus.ts'
import {
  explainLesson,
  firstNodeLabel,
  recordLearning,
  type LearningConfig,
  type LearningResult,
  type LearningWrite,
  type LessonState,
} from './graphify-learn.ts'
import { NO_SIGNALS, assemblePacket, extractLessonSignals, freshnessFor } from './packet.ts'
import { PROVIDER_NAMES, PROVIDER_SPECS, providerStatuses, registeredToolName, type ProviderServerNames } from './provider.ts'
import { routeTask } from './routing.ts'
import { registerKnowledgeTool } from './tool.ts'
import { registerKnowledgeDelegateTool } from './tool-delegate.ts'
import { registerKnowledgeLearnTool } from './tool-learn.ts'
import type {} from '@deepseek-ai/dsh-subagent'
import type {
  KnowledgeItem,
  KnowledgeMode,
  KnowledgePacket,
  KnowledgeProviderName,
  ProviderStatus,
  RetrieveOptions,
} from './types.ts'

export type * from './types.ts'
export { assertSupervisor, isWorker } from './authority.ts'
export { PROVIDER_NAMES, PROVIDER_SPECS, providerStatuses, registeredToolName, serverToolNames } from './provider.ts'
export { assemblePacket, byteLength, extractLessonSignals, freshnessFor, renderPacket } from './packet.ts'
export { routeTask } from './routing.ts'
export { memorixInventory, memorixPage, memorixStoredChunk } from './memorix-store.ts'
export { assertWritable, explainLesson, firstNodeLabel, parseLessonState, recordLearning } from './graphify-learn.ts'
export { gitnexusFreshness, parseStaleness } from './gitnexus.ts'
export type { GitnexusStaleness } from './gitnexus.ts'
export type {
  LearningConfig,
  LearningOutcome,
  LearningResult,
  LearningWrite,
  LessonState,
} from './graphify-learn.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledge: KnowledgeRouter
  }
}

/** One provider's enablement and MCP client server name. */
export interface ProviderConfig {
  /** Whether this provider participates; defaults to false. */
  enabled?: boolean
  /** MCP client `serverName`; defaults to the provider's own name. */
  serverName?: string
}

/** GitNexus enablement plus its retrieval bounds. */
export interface GitnexusConfig extends ProviderConfig {
  /** Maximum process groups the provider returns; defaults to 5. */
  limit?: number
  /** Maximum symbols per returned process; defaults to 10. */
  maxSymbols?: number
}

/** Graphify enablement plus its retrieval bounds. */
export interface GraphifyConfig extends ProviderConfig {
  /** Installed CLI launcher; omitted leaves the chat command unregistered. */
  cli?: GraphifyCommandConfig
  /** Graph traversal depth the provider searches; defaults to 1. */
  depth?: number
  /** Token budget the provider applies to its own output; defaults to 1500. */
  tokenBudget?: number
}

/** Learned-knowledge write-back settings. */
export interface LearningSettings {
  /** Whether the write-back tool is registered; defaults to false. */
  enabled?: boolean
  /** The Graphify executable name or path; defaults to `graphify`. */
  command?: string
  /** Graphify work-memory directory; omitted uses Graphify's own default. */
  memoryDir?: string
  /** Whether to run `reflect` after a successful write; defaults to true. */
  reflect?: boolean
}

/** Assisted-mode delegation settings. */
export interface DelegationSettings {
  /** The `ctx.subagents` provider used for a knowledge-carrying worker; defaults to `spawn`. */
  provider?: string
}

/** Plugin configuration. */
export interface Config {
  /** Automatic-retrieval mode; defaults to `off`. */
  mode?: KnowledgeMode
  /** GitNexus provider settings. */
  gitnexus?: GitnexusConfig
  /** Graphify provider settings. */
  graphify?: GraphifyConfig
  /** Learned-knowledge write-back settings. */
  learning?: LearningSettings
  /** Assisted-mode delegation settings. */
  delegation?: DelegationSettings
  /** Maximum UTF-8 bytes of one assembled packet; defaults to 4096. */
  maxPacketBytes?: number
}

/** Default packet byte bound. */
const DEFAULT_MAX_PACKET_BYTES = 4096

/** Default Graphify executable name. */
const DEFAULT_LEARNING_COMMAND = 'graphify'

/** Default subagent provider for a knowledge-carrying worker. */
const DEFAULT_DELEGATION_PROVIDER = 'spawn'

/** Resolved deployment configuration. */
interface ResolvedConfig {
  readonly mode: KnowledgeMode
  readonly providers: ProviderServerNames
  readonly maxPacketBytes: number
  readonly gitnexusLimit: number
  readonly gitnexusMaxSymbols: number
  readonly graphifyDepth: number
  readonly graphifyTokenBudget: number
  readonly learning: LearningConfig | undefined
  readonly delegationProvider: string
}

/**
 * Resolve plugin configuration into the values retrieval reads.
 * @param config - validated plugin configuration.
 * @returns Resolved mode, enabled server names, per-provider bounds, and write-back settings.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const providers: ProviderServerNames = {}
  for (const provider of PROVIDER_NAMES) {
    const block: ProviderConfig | undefined = provider === 'gitnexus' ? config.gitnexus : config.graphify
    if (block?.enabled !== true) continue
    providers[provider] = block.serverName ?? provider
  }
  const learning = config.learning
  return {
    mode: config.mode ?? 'off',
    providers,
    maxPacketBytes: config.maxPacketBytes ?? DEFAULT_MAX_PACKET_BYTES,
    gitnexusLimit: config.gitnexus?.limit ?? 5,
    gitnexusMaxSymbols: config.gitnexus?.maxSymbols ?? 10,
    graphifyDepth: config.graphify?.depth ?? 1,
    graphifyTokenBudget: config.graphify?.tokenBudget ?? 1500,
    learning: learning?.enabled === true
      ? {
        command: learning.command ?? DEFAULT_LEARNING_COMMAND,
        ...learning.memoryDir !== undefined ? { memoryDir: learning.memoryDir } : {},
        reflect: learning.reflect ?? true,
      }
      : undefined,
    delegationProvider: config.delegation?.provider ?? DEFAULT_DELEGATION_PROVIDER,
  }
}

/** Join the text blocks of one settled provider call. */
function resultText(result: ToolExecutionResult): string {
  const parts: string[] = []
  for (const block of result.content) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('\n')
}

/** One provider query this retrieval will dispatch. */
interface PlannedQuery {
  readonly provider: KnowledgeProviderName
  readonly toolName: string
}

/**
 * Bounded routing over MCP-backed knowledge providers.
 *
 * Every method reads the live tool registry, so a provider that is disabled,
 * absent, or filtered out reports as unavailable instead of failing a query.
 */
export class KnowledgeRouter extends Service {
  /** Tool registry this router dispatches provider queries through. */
  static inject = ['tools']

  /** Validated configuration schema. */
  static Config: z<Config> = z.object({
    mode: z.union([z.const('off'), z.const('manual'), z.const('assisted')]).default('off'),
    gitnexus: z.object({
      enabled: z.boolean().default(false),
      serverName: z.string(),
      limit: z.number().step(1).min(1).max(100).default(5),
      maxSymbols: z.number().step(1).min(1).max(200).default(10),
    }),
    graphify: z.object({
      enabled: z.boolean().default(false),
      serverName: z.string(),
      cli: z.object({ command: z.string().min(1), args: z.array(z.string()).default([]) }),
      depth: z.number().step(1).min(1).max(6).default(1),
      tokenBudget: z.number().step(1).min(1).default(1500),
    }),
    maxPacketBytes: z.number().step(1).min(1).default(DEFAULT_MAX_PACKET_BYTES),
    learning: z.object({
      enabled: z.boolean().default(false),
      command: z.string(),
      memoryDir: z.string(),
      reflect: z.boolean().default(true),
    }),
    delegation: z.object({
      provider: z.string().default(DEFAULT_DELEGATION_PROVIDER),
    }),
  })

  private readonly config: ResolvedConfig

  /**
   * Resolve configuration and register the model-facing tools.
   * @param ctx - plugin context owning the registration.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'knowledge')
    this.config = resolveConfig(config)
    ctx.inject(['commands'], (inner) => { registerKnowledgeCommand(inner, this) })
    const graphifyCli = config.graphify?.cli
    if (graphifyCli !== undefined) {
      ctx.inject(['commands'], (inner) => { registerGraphifyCommand(inner, graphifyCli) })
    }
    if (this.config.mode === 'off') return
    registerKnowledgeTool(ctx, this)
    if (this.config.learning !== undefined) registerKnowledgeLearnTool(ctx, this)
    if (this.config.mode === 'assisted') this.registerDelegation(ctx)
  }

  /**
   * Register the assisted-mode delegation tool where a subagent runtime exists.
   *
   * The service is read through an optional injection because the router works
   * without one; a deployment with no subagent provider simply has no
   * knowledge-carrying delegation entry.
   */
  private registerDelegation(ctx: Context): void {
    ctx.inject(['subagents'], (inner) => {
      registerKnowledgeDelegateTool(inner, this, {
        start: async (prompt, label, parent, signal) => {
          const maxDepth = inner.subagents.resolveMaxDepth()
          const started = await inner.subagents.startContinuable({
            provider: this.config.delegationProvider,
            label,
            request: { prompt: [{ type: 'text', text: prompt }], parent, ...maxDepth !== undefined ? { maxDepth } : {} },
            signal,
          })
          return String(started.childId)
        },
      })
    })
  }

  /** Automatic-retrieval mode this deployment selected. */
  get mode(): KnowledgeMode {
    return this.config.mode
  }

  /**
   * Write one validated finding to the learned-knowledge provider.
   *
   * This is the only path that persists knowledge and it never runs
   * automatically. A delegated worker is refused here, in the operation that
   * persists, so no caller can promote a worker's own answer.
   *
   * @param write - the validated finding and its source references.
   * @param signal - caller cancellation.
   * @param agent - the calling agent, whose authority decides whether the write is allowed.
   * @returns The written outcome and whether reflection ran.
   * @throws when the caller is a delegated worker, when write-back is not configured, or when the provider command fails.
   */
  async learn(write: LearningWrite, signal: AbortSignal, agent?: Agent): Promise<LearningResult> {
    assertSupervisor(agent, 'record learned knowledge')
    const learning = this.config.learning
    if (learning === undefined) throw new Error('knowledge write-back is not configured')
    return recordLearning(write, learning, signal)
  }

  /**
   * Report every supported provider's configuration and live connection state.
   * @param agent - caller whose scope the registry is read in; omitted reads the global view.
   * @returns One status per supported provider.
   */
  status(agent?: ScopeKey): ProviderStatus[] {
    return [...providerStatuses(this.config.providers, this.ctx.tools.schemas(agent))]
  }

  /**
   * Decide which providers a task warrants.
   * @param task - the task text to classify.
   * @returns Provider identities to query; empty when no cue matches.
   */
  route(task: string): KnowledgeProviderName[] {
    return [...routeTask(task)]
  }

  /**
   * Retrieve a bounded knowledge packet for one task.
   *
   * Providers that are disabled, unconfigured, or missing their query tool are
   * reported as unavailable rather than raising, so a dead provider never fails
   * the caller.
   *
   * @param task - the task text to route and query.
   * @param options - explicit providers, caller source references, and cancellation.
   * @returns The bounded packet, including which providers answered.
   */
  async retrieve(task: string, options: RetrieveOptions): Promise<KnowledgePacket> {
    const routed = options.providers ?? routeTask(task)
    const schemas = this.ctx.tools.schemas(options.agent)
    const planned: PlannedQuery[] = []
    const unavailable: KnowledgeProviderName[] = []
    for (const provider of routed) {
      const serverName = this.config.providers[provider]
      const toolName = serverName === undefined ? undefined : registeredToolName(schemas, serverName, PROVIDER_SPECS[provider].queryTool)
      if (toolName === undefined) unavailable.push(provider)
      else planned.push({ provider, toolName })
    }
    const items: KnowledgeItem[] = []
    for (const query of planned) {
      items.push(await this.queryProvider(query, task, options))
    }
    return assemblePacket({
      task,
      ...options.requestedBy !== undefined ? { requestedBy: options.requestedBy } : {},
      providers: planned.map(query => query.provider),
      unavailable,
      items,
      maxBytes: this.config.maxPacketBytes,
    })
  }

  /** Provider-specific query arguments, bounded by configuration. */
  private queryArguments(provider: KnowledgeProviderName, task: string): Record<string, string | number> {
    const argumentsByProvider: Record<KnowledgeProviderName, Record<string, string | number>> = {
      gitnexus: {
        [PROVIDER_SPECS.gitnexus.taskArgument]: task,
        limit: this.config.gitnexusLimit,
        max_symbols: this.config.gitnexusMaxSymbols,
      },
      graphify: {
        [PROVIDER_SPECS.graphify.taskArgument]: task,
        depth: this.config.graphifyDepth,
        token_budget: this.config.graphifyTokenBudget,
      },
    }
    return argumentsByProvider[provider]
  }

  /** Dispatch one provider query and package its result. */
  private async queryProvider(
    query: PlannedQuery,
    task: string,
    options: RetrieveOptions,
  ): Promise<KnowledgeItem> {
    const retrievedAt = new Date().toISOString()
    const result = await this.ctx.tools.execute({
      callId: ToolCallId(randomUUID()),
      name: query.toolName,
      arguments: this.queryArguments(query.provider, task),
      ...options.agent !== undefined ? { agent: options.agent } : {},
      ...options.execution !== undefined ? { parent: options.execution.token, rootCallId: options.execution.rootCallId } : {},
      signal: options.signal,
    })
    const text = resultText(result)
    const signals = query.provider === 'graphify' ? extractLessonSignals(text) : NO_SIGNALS
    const lesson = query.provider === 'graphify' ? await this.probeLesson(text, options.signal) : undefined
    const freshness = query.provider === 'gitnexus'
      ? gitnexusFreshness(parseStaleness(text))
      : freshnessFor(query.provider, signals, lesson)
    return {
      provider: query.provider,
      serverName: this.config.providers[query.provider] as string,
      task,
      text,
      freshness,
      signals,
      retrievedAt,
    }
  }

  /**
   * Ask Graphify's CLI for the seed node's lesson state.
   *
   * A probe failure never fails the retrieval: the item keeps `unknown`
   * freshness, which is the honest reading when no state could be read.
   */
  private async probeLesson(text: string, signal: AbortSignal): Promise<LessonState | undefined> {
    const learning = this.config.learning
    if (learning === undefined) return undefined
    const node = firstNodeLabel(text)
    if (node === undefined) return undefined
    try {
      return await explainLesson(node, learning, signal)
    } catch (error: unknown) {
      this.ctx.logger.warn(`knowledge: Graphify explain probe failed for ${node}: ${String(error)}`)
      return undefined
    }
  }
}

export default KnowledgeRouter
