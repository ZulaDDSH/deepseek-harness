import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { QuotaController } from '@deepseek-ai/dsh-api-quota-controller'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

const LIMIT_BODY = JSON.stringify({
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'You have reached your specified API usage limits. You will regain access on 2999-11-01 at 00:00 UTC.',
  },
})
const STREAM = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","model":"claude-sonnet-4-5","usage":{"input_tokens":1,"output_tokens":0}}}',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
  'event: message_stop\ndata: {"type":"message_stop"}',
]

async function mount(baseURL: string, apiKeyEnv: string | undefined = 'PI_TEST_KEY') {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.provide('credentials', {
    resolve: async (ref: string) => ref === 'PI_TEST_KEY' ? { value: 'test-key', source: 'test' } : undefined,
    readRecord: async () => undefined,
  } as never)
  const quota = new QuotaController(ctx)
  await ctx.plugin(LlmPiAi, { providers: { anthropic: { ...apiKeyEnv === undefined ? {} : { apiKeyEnv }, baseURL } } })
  return { ctx, quota }
}

describe('Claude usage on the main request path', () => {
  it('records the unified limit headers of a successful response', async () => {
    const server = await mockServer([{
      events: STREAM,
      headers: {
        'anthropic-ratelimit-unified-5h-utilization': '0.42',
        'anthropic-ratelimit-unified-5h-reset': '4102444800',
        'anthropic-ratelimit-unified-7d-utilization': '0.9',
        'anthropic-ratelimit-unified-7d-reset': '4102444800',
      },
    }])
    const { ctx, quota } = await mount(server.url)
    const result = await assemble(ctx, { provider: 'anthropic', model: 'claude-sonnet-4-5', messages: [] })
    expect(result.finish).toMatchObject({ kind: 'stop' })
    await expect(quota.fetch('anthropic')).resolves.toMatchObject({
      ok: true,
      windows: { '5h': { usedPercent: 42, resetAt: 4_102_444_800_000 }, weekly: { usedPercent: 90 } },
      billing: { active: 'api' },
    })
  })

  it('records an API spending-limit refusal with the date access returns', async () => {
    const server = await mockServer([{ status: 400, body: LIMIT_BODY }])
    const { ctx, quota } = await mount(server.url)
    const result = await assemble(ctx, { provider: 'anthropic', model: 'claude-sonnet-4-5', messages: [] })
    expect(result.finish).toMatchObject({ kind: 'error' })
    const fetched = await quota.fetch('anthropic')
    expect(fetched).toMatchObject({ ok: true, apiLimit: { resetAt: Date.UTC(2999, 10, 1) }, billing: { active: 'api' } })
  })

  it('ignores a different refusal', async () => {
    const server = await mockServer([{ status: 400, body: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad field' } }) }])
    const { ctx, quota } = await mount(server.url)
    await assemble(ctx, { provider: 'anthropic', model: 'claude-sonnet-4-5', messages: [] })
    expect(await quota.fetch('anthropic')).not.toHaveProperty('apiLimit')
  })
})

describe('Claude usage per account', () => {
  it('keeps each alias account windows apart from the base account', async () => {
    const server = await mockServer([{
      events: STREAM,
      headers: { 'anthropic-ratelimit-unified-5h-utilization': '0.3', 'anthropic-ratelimit-unified-5h-reset': '4102444800' },
    }])
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.provide('credentials', {
      resolve: async (ref: string) => ref === 'PI_TEST_KEY' ? { value: 'test-key', source: 'test' } : undefined,
      readRecord: async () => undefined,
    } as never)
    const quota = new QuotaController(ctx)
    await ctx.plugin(LlmPiAi, { providers: {
      anthropic: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url },
      'claude-work': { base: 'anthropic', apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url, displayName: 'Claude (work)' },
    } })
    await assemble(ctx, { provider: 'claude-work', model: 'claude-sonnet-4-5', messages: [] })
    await expect(quota.fetch('claude-work')).resolves.toMatchObject({
      ok: true,
      providerName: 'Claude (work)',
      windows: { '5h': { usedPercent: 30 } },
    })
    const base = await quota.fetch('anthropic')
    expect(base).toMatchObject({ ok: true })
    expect(base).not.toHaveProperty('windows.5h')
  })
})
