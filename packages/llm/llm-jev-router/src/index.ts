import type { Context } from '@deepseek-ai/cordis'
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
import type {} from '@deepseek-ai/dsh-settings'

export const name = 'llm-jev-router'
export const inject = ['llm']
/** TypeSafe Jev evaluation endpoint. */
export const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
/** TypeSafe flagship model alias. */
export const DEFAULT_MODEL = 'jev-latest'
/** Default credential/environment reference. */
export const DEFAULT_API_KEY_ENV = 'TYPESAFE_API_KEY'
/** User-settings namespace owned by the plugin. */
export const JEV_ROUTER_SETTINGS_NAMESPACE = 'jev-router'

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

/** Runtime schema for the `jev-router` settings section. */
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

interface JevChoiceAnswer {
  readonly choice?: unknown
  readonly confidence?: unknown
}

interface JevResponse {
  readonly answers?: Record<string, JevChoiceAnswer>
}

/** Parsed route decision returned by Jev. */
export interface JevDecision {
  readonly route: string
  readonly confidence: number
}

/** Injectable Jev decision client. */
export interface JevClient {
  /** Evaluate one admitted step. */
  decide(messages: readonly UserMessage[], config: Config, signal: AbortSignal): Promise<JevDecision>
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
    case 'tool-result': return `[tool-result: ${block.toolCallId}]`
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
  return {
    async decide(messages, config, signal): Promise<JevDecision> {
      const rawKey = await resolveApiKey(config)
      if (rawKey === undefined) throw new Error(`no credential resolved from ${config.apiKeyEnv}`)
      const apiKey = assertUsableApiKey(rawKey, 'jev-router', config.apiKeyEnv)
      const criteria = Object.fromEntries(config.routes.map(route => [route.id, route.description]))
      const body = {
        model: config.model,
        state: stateForMessages(messages, config.stateMaxChars),
        questions: {
          route: {
            type: 'choice',
            instructions: 'Choose the least costly configured model that can complete this task reliably.',
            criteria,
          },
        },
      }
      const fused = abortableSignal(signal, config.timeoutMs)
      try {
        const response = await fetchImpl(config.endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: fused.signal,
        })
        if (!response.ok) throw new Error(`Jev returned HTTP ${response.status}`)
        return parseDecision(await response.json())
      } finally {
        fused.dispose()
      }
    },
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
  let current: () => Config = () => initial
  const decisions = new WeakMap<Agent, Map<string, CachedRoute>>()
  const client = createJevClient(async (config) => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) return (await credentials.resolve(credentialRef(config.apiKeyEnv)))?.value
    return launchEnvironmentOf(ctx).get(config.apiKeyEnv)?.value
  })
  ctx.llm.registerConfigurableProviders([{
    provider: 'jev-router',
    displayName: 'TypeSafe / Jev',
    settingsNs: JEV_ROUTER_SETTINGS_NAMESPACE,
    settingsPath: [],
  }])

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, JEV_ROUTER_SETTINGS_NAMESPACE, Config, initial, {
      validate: validateConfig,
      setSource: (source) => { current = source },
      onChange: () => {},
    })
  })

  ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const admitted = await next()
    const config = current()
    if (admitted.kind === 'reject' || !config.enabled || config.routes.length === 0 || payload.signal.aborted) return admitted
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
