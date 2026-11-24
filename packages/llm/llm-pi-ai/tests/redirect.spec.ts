import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

async function harness(baseURL: string): Promise<Context> {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers: { deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL } } })
  return ctx
}

describe('pi-ai chat request redirects', () => {
  it.each([307, 308])('does not replay the conversation to the target of a %i', async (status) => {
    const target = await mockServer([{ events: textEvents }])
    const origin = await mockServer([{ status, headers: { location: `${target.url}/chat/completions` } }])
    const ctx = await harness(origin.url)

    const result = await assemble(ctx, {
      model: 'deepseek-flash',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'private conversation' }],
        source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      })],
    })

    expect(result.finish.kind).toBe('error')

    expect(origin.paths).toEqual(['/chat/completions'])
    expect(target.paths).toEqual([])
  })
})
