import { describe, expect, it, vi } from 'vitest'
import {
  applyRoute,
  createJevClient,
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  selectedRoute,
  stateForMessages,
  type Config,
} from '../src/index.ts'
import { ReasoningEffortId, type LlmCallConfig, type UserMessage } from '@deepseek-ai/dsh-llm'

const config: Config = {
  enabled: true,
  apiKeyEnv: 'TYPESAFE_API_KEY',
  endpoint: DEFAULT_ENDPOINT,
  model: DEFAULT_MODEL,
  timeoutMs: 1000,
  minConfidence: 0.8,
  stateMaxChars: 1000,
  fallback: 'keep',
  failOpen: true,
  routes: [
    { id: 'lean', provider: 'claude-code', model: 'claude-sonnet', description: 'Short, routine tasks' },
    { id: 'powerful', provider: 'claude-code', model: 'claude-opus', description: 'Complex tasks', reasoningEffort: 'high' },
  ],
}

const message = (text: string): UserMessage => ({
  id: 'message' as UserMessage['id'],
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind: 'plugin', plugin: 'test', form: 'notice', summary: text },
})

describe('Jev router', () => {
  it('bounds the state sent to Jev without breaking JSON', () => {
    const state = stateForMessages([message('a'.repeat(300))], 80)
    expect(state.length).toBeLessThanOrEqual(80)
    expect(JSON.parse(state)).toMatchObject({ truncated: true })
  })

  it('calls the TypeSafe endpoint and parses a choice decision', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key')
      const body = JSON.parse(init?.body as string) as { model: string; questions: Record<string, unknown> }
      expect(body.model).toBe(DEFAULT_MODEL)
      expect(body.questions).toHaveProperty('route')
      return new Response(JSON.stringify({ answers: { route: { choice: 'lean', confidence: 0.93 } } }), { status: 200 })
    })
    const client = createJevClient(async () => 'test-key', fetchImpl)
    await expect(client.decide([message('rename a variable')], config, new AbortController().signal))
      .resolves.toEqual({ route: 'lean', confidence: 0.93 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects an HTTP failure without selecting a route', async () => {
    const client = createJevClient(async () => 'test-key', async () => new Response('no', { status: 503 }))
    await expect(client.decide([], config, new AbortController().signal)).rejects.toThrow('HTTP 503')
  })

  it('uses the confidence threshold and configured fallback', () => {
    expect(selectedRoute({ route: 'lean', confidence: 0.79 }, Object.assign({}, config, { fallback: 'powerful' }))?.id).toBe('powerful')
    expect(selectedRoute({ route: 'missing', confidence: 1 }, config)).toBeUndefined()
    expect(selectedRoute({ route: 'lean', confidence: 0.8 }, config)?.id).toBe('lean')
  })

  it('replaces the base route and clears inherited reasoning when target has none', () => {
    const base: LlmCallConfig = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: ReasoningEffortId('high'),
      temperature: 0.2,
    }
    expect(applyRoute(base, config.routes[0]!)).toEqual({
      provider: 'claude-code',
      model: 'claude-sonnet',
      temperature: 0.2,
    })
    expect(applyRoute(base, config.routes[1]!)).toMatchObject({
      provider: 'claude-code',
      model: 'claude-opus',
      reasoningEffort: ReasoningEffortId('high'),
    })
  })
})
