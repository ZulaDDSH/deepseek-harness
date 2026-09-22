import { describe, expect, it, vi } from 'vitest'
import {
  applyRoute,
  createJevClient,
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  selectedRoute,
  selectRelevantGrepMatches,
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

  it('scores grep candidates with parallel Noul questions', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(init?.body as string) as {
        questions: Record<string, { type: string; instructions: { search_pattern: string } }>
      }
      expect(body.questions.match_0?.type).toBe('noul')
      expect(body.questions.match_0?.instructions.search_pattern).toBe('router')
      return new Response(JSON.stringify({
        answers: {
          match_0: { type: 'noul', noul: 0.91 },
          match_1: { type: 'noul', noul: 0.14 },
        },
      }), { status: 200 })
    })
    const client = createJevClient(async () => 'test-key', fetchImpl)
    await expect(client.scoreGrep(
      '{"messages":[{"role":"user","content":"fix router"}]}',
      'router',
      [
        { path: 'a.ts', lineNumber: 1, line: 'router code' },
        { path: 'b.ts', lineNumber: 2, line: 'unrelated code' },
      ],
      config,
      new AbortController().signal,
    )).resolves.toEqual([0.91, 0.14])
  })

  it('keeps the highest Jev relevance scores while preserving grep order', () => {
    const matches = [
      { path: 'a.ts', lineNumber: 1, line: 'a' },
      { path: 'b.ts', lineNumber: 2, line: 'b' },
      { path: 'c.ts', lineNumber: 3, line: 'c' },
    ]
    expect(selectRelevantGrepMatches(matches, [0.8, 0.1, 0.9], 2)).toEqual([matches[0], matches[2]])
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
