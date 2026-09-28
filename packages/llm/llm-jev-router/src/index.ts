import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import {
  assertUsableApiKey,
  ReasoningEffortId,
  type ContentBlock,
  type LlmCallConfig,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/cordis-plugin-loader'

export const name = 'llm-jev-router'
export const inject = ['llm']
/** TypeSafe Jev evaluation endpoint. */
export const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
/** TypeSafe flagship model alias. */
export const DEFAULT_MODEL = 'jev-latest'
/** Default credential/environment reference. */
export const DEFAULT_API_KEY_ENV = 'TYPESAFE_API_KEY'
/** Minimum grep match count before Jev relevance ranking is considered. */
export const GREP_RELEVANCE_MIN_MATCHES = 100
/** Number of highest-scoring grep matches retained after Jev ranking. */
export const GREP_RELEVANCE_KEEP_MATCHES = 32
/** Maximum grep candidates sent to Jev for one relevance-ranking request. */
export const GREP_RELEVANCE_MAX_CANDIDATES = 250

/** Allow-listed DSH destination selected by Jev. */
export interface JevRoute {
  /** Jev choice identifier. */
  id: string
  /** Registered DSH provider route. */
  provider: string
  /** Provider-owned model identifier. */
  model: string
  /** Choice criteria sent to Jev. */
  description: string
  /** Optional provider reasoning effort. */
  reasoningEffort?: string
}

/** Jev router settings. */
export interface Config {
  /** Enable automatic routing. */
  enabled: boolean
  /** Credential/environment reference. */
  apiKeyEnv: string
  /** TypeSafe evaluation endpoint. */
  endpoint: string
  /** Jev model alias. */
  model: string
  /** Request timeout in milliseconds. */
  timeoutMs: number
  /** Minimum accepted decision confidence. */
  minConfidence: number
  /** Maximum state characters sent to Jev. */
  stateMaxChars: number
  /** Route id or `keep` for the base route. */
  fallback: string
  /** Preserve the base route when Jev fails. */
  failOpen: boolean
  /** Allow-listed destination routes. */
  routes: JevRoute[]
}

const routeSchema: z<JevRoute> = z.object({
  id: z.string().min(1).required(),
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  description: z.string().min(1).required(),
  reasoningEffort: z.string().min(1),
})

/** Runtime schema for the plugin config. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  endpoint: z.string().default(DEFAULT_ENDPOINT),
  model: z.string().min(1).default(DEFAULT_MODEL),
  timeoutMs: z.number().step(1).min(1).default(1500),
  minConfidence: z.number().min(0).max(1).default(0.8),
  stateMaxChars: z.number().step(1).min(256).default(12000),
  fallback: z.string().min(1).default('keep'),
  failOpen: z.boolean().default(true),
  routes: z.array(routeSchema).default([]),
})

interface JevAnswer {
  readonly choice?: unknown
  readonly confidence?: unknown
  readonly noul?: unknown
}

interface JevResponse {
  readonly answers?: Record<string, JevAnswer>
}

/** Parsed route decision returned by Jev. */
export interface JevDecision {
  readonly route: string
  readonly confidence: number
}

/** One grep candidate supplied to Jev relevance ranking. */
export interface JevGrepMatch {
  /** Repository-relative file path. */
  readonly path: string
  /** One-based line number of the match. */
  readonly lineNumber: number
  /** Matched source line. */
  readonly line: string
}

/** Injectable Jev decision client. */
export interface JevClient {
  /** Evaluate one admitted step. */
  decide(messages: readonly UserMessage[], config: Config, signal: AbortSignal): Promise<JevDecision>
  /** Score grep candidates for relevance to the current task. */
  scoreGrep(
    state: string,
    pattern: string,
    matches: readonly JevGrepMatch[],
    config: Config,
    signal: AbortSignal,
  ): Promise<number[]>
}

interface CachedRoute {
  readonly route: JevRoute
}

function validateConfig(config: Config): void {
  let endpoint: URL
  try {
    endpoint = new URL(config.endpoint)
  } catch {
    throw new Error('jev-router: endpoint must be an absolute HTTP(S) URL')
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)
    || endpoint.username.length > 0
    || endpoint.password.length > 0
    || endpoint.search.length > 0
    || endpoint.hash.length > 0) {
    throw new Error('jev-router: endpoint must be an HTTP(S) URL without credentials, query, or fragment')
  }
  const ids = new Set<string>()
  for (const route of config.routes) {
    if (ids.has(route.id)) throw new Error(`jev-router: duplicate route id "${route.id}"`)
    ids.add(route.id)
  }
  if (config.fallback !== 'keep' && !ids.has(config.fallback)) {
    throw new Error(`jev-router: fallback route "${config.fallback}" is not configured`)
  }
}

function contentText(block: ContentBlock): string {
  switch (block.type) {
    case 'text': return block.text
    case 'reasoning': return `[reasoning: ${block.text}]`
    case 'tool-call': return `[tool-call: ${block.name}]`
    case 'image': return '[image attachment]'
    case 'file': return '[file attachment]'
    default: return '[content block]'
  }
}

/** Project admitted messages into bounded Jev state.
 * @param messages admitted user messages.
 * @param maxChars maximum serialized state length.
 * @returns bounded JSON state.
 */
export function stateForMessages(messages: readonly UserMessage[], maxChars: number): string {
  const state = messages.map(message => ({
    role: message.role,
    content: message.content.map(contentText).join('\n'),
  }))
  const full = JSON.stringify({ messages: state })
  if (full.length <= maxChars) return full

  const totalContent = state.reduce((sum, message) => sum + message.content.length, 0)
  const build = (contentBudget: number): string => {
    let remaining = contentBudget
    const bounded = state.map((message) => {
      const content = message.content.slice(0, remaining)
      remaining -= content.length
      return { role: message.role, content }
    })
    return JSON.stringify({ messages: bounded, truncated: true })
  }
  let low = 0
  let high = totalContent
  let best = build(0)
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = build(middle)
    if (candidate.length <= maxChars) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best.length <= maxChars ? best : JSON.stringify({ messages: [] })
}

function abortableSignal(signal: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  const onAbort = (): void => { controller.abort() }
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    },
  }
}

function parseDecision(value: unknown): JevDecision {
  if (value === null || typeof value !== 'object') throw new Error('Jev returned a non-object response')
  const answer = (value as JevResponse).answers?.route
  if (answer === undefined || typeof answer.choice !== 'string' || typeof answer.confidence !== 'number') {
    throw new Error('Jev response did not contain answers.route.choice and confidence')
  }
  if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
    throw new Error('Jev response confidence was outside the 0..1 range')
  }
  return { route: answer.choice, confidence: answer.confidence }
}

/** Create the HTTP Jev client.
 * @param resolveApiKey resolves the configured credential reference.
 * @param fetchImpl injectable HTTP implementation.
 * @returns a Jev decision client.
 */
export function createJevClient(
  resolveApiKey: (config: Config) => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
): JevClient {
  const request = async (
    state: string,
    questions: Record<string, unknown>,
    config: Config,
    signal: AbortSignal,
  ): Promise<unknown> => {
    const rawKey = await resolveApiKey(config)
    if (rawKey === undefined) throw new Error(`no credential resolved from ${config.apiKeyEnv}`)
    const apiKey = assertUsableApiKey(rawKey, 'jev-router', config.apiKeyEnv)
    const fused = abortableSignal(signal, config.timeoutMs)
    try {
      const response = await fetchImpl(config.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: config.model, state, questions }),
        signal: fused.signal,
      })
      if (!response.ok) throw new Error(`Jev returned HTTP ${response.status}`)
      return await response.json()
    } finally {
      fused.dispose()
    }
  }

  return {
    async decide(messages, config, signal): Promise<JevDecision> {
      const criteria = Object.fromEntries(config.routes.map(route => [route.id, route.description]))
      return parseDecision(await request(
        stateForMessages(messages, config.stateMaxChars),
        {
          route: {
            type: 'choice',
            instructions: 'Choose the least costly configured model that can complete this task reliably.',
            criteria,
          },
        },
        config,
        signal,
      ))
    },

    async scoreGrep(state, pattern, matches, config, signal): Promise<number[]> {
      const questions = Object.fromEntries(matches.map((match, index) => [
        `match_${index}`,
        {
          type: 'noul',
          instructions: {
            question: 'Is this grep match materially relevant to completing the current task?',
            search_pattern: pattern,
            candidate: match,
          },
          criteria: {
            true: 'The match directly helps locate, understand, verify, or change code relevant to the task.',
            false: 'The match is incidental, unrelated, duplicate noise, or does not help complete the task.',
          },
        },
      ]))
      const value = await request(state, questions, config, signal)
      if (value === null || typeof value !== 'object') throw new Error('Jev returned a non-object response')
      const answers = (value as JevResponse).answers
      if (answers === undefined) throw new Error('Jev response did not contain answers')
      return matches.map((_match, index) => {
        const noul = answers[`match_${index}`]?.noul
        if (typeof noul !== 'number' || !Number.isFinite(noul) || noul < 0 || noul > 1) {
          throw new Error(`Jev response contained an invalid Noul for match_${index}`)
        }
        return noul
      })
    },
  }
}

/**
 * Select the highest-scoring grep candidates while preserving source order.
 * @param matches - candidate grep matches.
 * @param scores - Jev relevance scores aligned with matches.
 * @param keep - maximum number of matches to retain.
 * @returns selected matches in their original order.
 */
export function selectRelevantGrepMatches(
  matches: readonly JevGrepMatch[],
  scores: readonly number[],
  keep: number = GREP_RELEVANCE_KEEP_MATCHES,
): JevGrepMatch[] {
  if (matches.length !== scores.length) throw new Error('Jev grep scores must match candidate count')
  if (!Number.isInteger(keep) || keep < 1) throw new Error('Jev grep keep count must be a positive integer')
  if (matches.length <= keep) return [...matches]
  const selected = new Set(scores
    .map((score, index) => ({ score, index }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, keep)
    .map(item => item.index))
  return matches.filter((_match, index) => selected.has(index))
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    jevRouter: JevRouter
  }
}

/**
 * Grep relevance ranking backed by the Jev client. Every failure path returns
 * the input matches unchanged, so a consumer never loses grep output to Jev.
 */
export class JevRouter extends Service {
  /**
   * @param ctx - owning plugin context.
   * @param config - reads the active router settings.
   * @param client - Jev request client.
   * @param states - task state recorded per Agent by the pre-step listener.
   */
  constructor(
    ctx: Context,
    private readonly config: () => Config,
    private readonly client: JevClient,
    private readonly states: WeakMap<Agent, string>,
  ) {
    super(ctx, 'jevRouter')
  }

  /**
   * Keep the grep matches Jev ranks most relevant to the Agent's current task.
   * Returns `input.matches` unchanged when routing is disabled, the signal is
   * aborted, fewer than {@link GREP_RELEVANCE_MIN_MATCHES} matches arrive, the
   * Agent has no recorded state, or scoring fails.
   * @param input - requesting Agent, grep pattern, candidate matches, and abort signal.
   * @returns at most {@link GREP_RELEVANCE_KEEP_MATCHES} matches in input order, or the input matches.
   */
  async filterGrepMatches(input: {
    agent: Agent
    pattern: string
    matches: readonly JevGrepMatch[]
    signal: AbortSignal
  }): Promise<readonly JevGrepMatch[]> {
    const config = this.config()
    if (!config.enabled || input.signal.aborted || input.matches.length < GREP_RELEVANCE_MIN_MATCHES) {
      return input.matches
    }
    const state = this.states.get(input.agent)
    if (state === undefined) return input.matches
    const candidates = input.matches.slice(0, GREP_RELEVANCE_MAX_CANDIDATES)
    try {
      const scores = await this.client.scoreGrep(state, input.pattern, candidates, config, input.signal)
      return selectRelevantGrepMatches(candidates, scores)
    } catch (error) {
      this.ctx.logger.warn('jev-router: grep relevance scoring failed; preserving normal grep output')
      this.ctx.logger.warn(error)
      return input.matches
    }
  }
}

function stepKey(turn: number, step: number): string {
  return `${turn}:${step}`
}

/** Resolve a decision through confidence and fallback policy.
 * @param decision parsed Jev decision.
 * @param config active router settings.
 * @returns an allow-listed route or undefined to preserve the base route.
 */
export function selectedRoute(decision: JevDecision, config: Config): JevRoute | undefined {
  const route = config.routes.find(candidate => candidate.id === decision.route)
  if (route !== undefined && decision.confidence >= config.minConfidence) return route
  if (config.fallback === 'keep') return undefined
  return config.routes.find(candidate => candidate.id === config.fallback)
}

/** Apply a selected route without mutating the frozen base config.
 * @param config base DSH call configuration.
 * @param route selected destination.
 * @returns the replacement call configuration.
 */
export function applyRoute(config: LlmCallConfig, route: JevRoute): LlmCallConfig {
  const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = config
  return {
    ...withoutInheritedEffort,
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) },
  }
}

/** Install Jev routing into the agent waterfalls. */
export function apply(ctx: Context, initial: Config): void {
  validateConfig(initial)
  const current = (): Config => initial
  const decisions = new WeakMap<Agent, Map<string, CachedRoute>>()
  const states = new WeakMap<Agent, string>()
  const client = createJevClient(async (config) => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) return (await credentials.resolve(credentialRef(config.apiKeyEnv)))?.value
    return launchEnvironmentOf(ctx).get(config.apiKeyEnv)?.value
  })
  new JevRouter(ctx, current, client, states)
  ctx.llm.registerConfigurableProviders([{
    provider: 'jev-router',
    displayName: 'TypeSafe / Jev',
    settingsNs: ctx.fiber.entry?.options.id ?? name,
    settingsPath: [],
  }])

  ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const admitted = await next()
    const config = current()
    if (admitted.kind === 'reject' || payload.signal.aborted) return admitted
    if (!config.enabled) return admitted
    states.set(payload.agent, stateForMessages(admitted.messages, config.stateMaxChars))
    if (config.routes.length === 0) return admitted
    try {
      const decision = await client.decide(admitted.messages, config, payload.signal)
      const route = selectedRoute(decision, config)
      if (route !== undefined) {
        let perAgent = decisions.get(payload.agent)
        if (perAgent === undefined) {
          perAgent = new Map()
          decisions.set(payload.agent, perAgent)
        }
        perAgent.set(stepKey(payload.turn, payload.step), { route })
      }
    } catch (error) {
      ctx.logger.warn('jev-router: Jev decision failed; preserving the configured model route')
      ctx.logger.warn(error)
      if (!config.failOpen) return { kind: 'reject' }
    }
    return admitted
  })

  ctx.on('agent/request', async (payload, next): Promise<LlmCallConfig> => {
    const base = await next()
    const route = decisions.get(payload.agent)?.get(stepKey(payload.turn, payload.step))
    if (route === undefined || payload.signal.aborted) return base
    return applyRoute(base, route.route)
  }, { prepend: true })
}
