import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer } from './mock-server.ts'

type Body = Record<string, unknown>

/** A Codex access token: pi-ai reads the ChatGPT account id from its payload. */
const CODEX_TOKEN = [
  'eyJhbGciOiJub25lIn0',
  Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' } })).toString('base64'),
  'sig',
].join('.')

const REJECTED = { status: 400, body: JSON.stringify({ error: { type: 'invalid_request_error', message: 'mock stop' } }) }

beforeEach(() => {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

/** The request body one provider call puts on the wire, captured by a local stand-in. */
async function sentBody(provider: string, model: string, reasoningEffort?: string, profile: Record<string, unknown> = {}): Promise<Body> {
  const server = await mockServer([REJECTED])
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers: { [provider]: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url, ...profile } } })
  const result = await assemble(ctx, {
    provider,
    model,
    messages: [],
    ...reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) },
  })
  expect(result.finish.kind).toBe('error')
  expect(server.requests).toHaveLength(1)
  return server.requests[0] as Body
}

/** The finish of an effort the model refuses, with no request reaching the wire. */
async function refusedBefore(provider: string, model: string, reasoningEffort: string): Promise<unknown> {
  const server = await mockServer([REJECTED])
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers: { [provider]: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } } })
  const result = await assemble(ctx, { provider, model, messages: [], reasoningEffort: ReasoningEffortId(reasoningEffort) })
  expect(server.requests).toHaveLength(0)
  return result.finish
}

describe('Anthropic adaptive effort on Claude 5.5 (mid-conversation effort)', () => {
  it('leaves Default to the model: adaptive thinking, no effort field', async () => {
    const body = await sentBody('anthropic', 'claude-opus-5-5')
    expect(body.thinking).toMatchObject({ type: 'adaptive' })
    expect(body).not.toHaveProperty('output_config')
    expect((body.messages as Body[]).some(message => 'output_config' in message)).toBe(false)
  })

  it.each(['low', 'medium', 'high', 'max'])('sends %s as the effort, not the pi-ai default high', async (level) => {
    const body = await sentBody('anthropic', 'claude-opus-5-5', level)
    expect(body.thinking).toMatchObject({ type: 'adaptive' })
    expect(body.output_config).toEqual({ effort: level })
    expect((body.messages as Body[]).at(-1)).toMatchObject({ output_config: { effort: level } })
  })
})

describe('Anthropic adaptive effort on Claude 4.7 (top-level output_config)', () => {
  it('leaves Default to the model: adaptive thinking, no effort field', async () => {
    const body = await sentBody('anthropic', 'claude-opus-4-7')
    expect(body.thinking).toMatchObject({ type: 'adaptive' })
    expect(body).not.toHaveProperty('output_config')
  })

  it.each(['low', 'medium', 'high', 'max'])('sends %s as output_config and never type enabled', async (level) => {
    const body = await sentBody('anthropic', 'claude-opus-4-7', level)
    expect(body.thinking).toMatchObject({ type: 'adaptive' })
    expect(body.output_config).toEqual({ effort: level })
  })
})

describe('Anthropic manual budget thinking on Claude 4.5 (no adaptive)', () => {
  it('leaves Default off because the documented default is off: no thinking field', async () => {
    const body = await sentBody('anthropic', 'claude-sonnet-4-5')
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('output_config')
  })

  it.each([
    ['low', 2048],
    ['medium', 8192],
    ['high', 16384],
  ])('sends %s as an enabled budget of %i tokens and no adaptive or effort field', async (level, budget) => {
    const body = await sentBody('anthropic', 'claude-sonnet-4-5', level)
    expect(body.thinking).toMatchObject({ type: 'enabled', budget_tokens: budget })
    expect(body).not.toHaveProperty('output_config')
  })

  it('refuses max before any request, since 4.5 has no max level', async () => {
    expect(await refusedBefore('anthropic', 'claude-sonnet-4-5', 'max')).toMatchObject({ kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT' } })
  })
})

describe('OpenAI Responses reasoning effort', () => {
  it('omits reasoning for Default instead of sending none', async () => {
    const body = await sentBody('openai', 'gpt-5.6-sol')
    expect(body).not.toHaveProperty('reasoning')
  })

  it('sends off as none', async () => {
    expect(await sentBody('openai', 'gpt-5.6-sol', 'off')).toMatchObject({ reasoning: { effort: 'none' } })
  })

  it.each(['low', 'medium', 'high', 'max'])('sends %s as the reasoning effort', async (level) => {
    expect(await sentBody('openai', 'gpt-5.6-sol', level)).toMatchObject({ reasoning: { effort: level } })
  })
})

describe('OpenAI Codex reasoning effort', () => {
  beforeEach(() => {
    vi.stubEnv('PI_TEST_KEY', CODEX_TOKEN)
  })

  it('keeps the reasoning object for Default but omits its effort', async () => {
    const body = await sentBody('openai-codex', 'gpt-5.6-sol', undefined, { transport: 'sse' })
    expect(body.reasoning).toEqual({ summary: 'auto' })
  })

  it.each(['low', 'medium', 'high', 'max'])('sends %s as the reasoning effort', async (level) => {
    expect(await sentBody('openai-codex', 'gpt-5.6-sol', level, { transport: 'sse' })).toMatchObject({ reasoning: { effort: level } })
  })
})

describe('DeepSeek chat-completions reasoning effort (pi-ai)', () => {
  it('leaves Default to the provider default: thinking not disabled', async () => {
    const body = await sentBody('deepseek', 'deepseek-v4-flash')
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  it.each(['low', 'high', 'max'])('sends %s as thinking enabled with that reasoning_effort', async (level) => {
    expect(await sentBody('deepseek', 'deepseek-v4-flash', level)).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: level,
    })
  })

  it('refuses medium, which DeepSeek maps to high', async () => {
    expect(await refusedBefore('deepseek', 'deepseek-v4-flash', 'medium')).toMatchObject({ kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT' } })
  })
})

describe('offered reasoning levels', () => {
  it.each([
    ['anthropic', 'claude-opus-5-5'],
    ['anthropic', 'claude-sonnet-4-5'],
    ['openai-codex', 'gpt-5.6-sol'],
  ])('offers low but no minimal for %s %s', async (provider, model) => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: { [provider]: { apiKeyEnv: 'PI_TEST_KEY' } } })
    const info = await ctx.llm.resolveModelInfo(provider, model)
    const ids = info.reasoning?.efforts.map(effort => effort.id) ?? []
    expect(ids).toContain('low')
    expect(ids).not.toContain('minimal')
  })

  it('refuses minimal on Claude 5.5 before any request', async () => {
    expect(await refusedBefore('anthropic', 'claude-opus-5-5', 'minimal')).toMatchObject({ kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT' } })
  })
})
