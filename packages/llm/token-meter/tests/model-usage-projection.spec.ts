import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import TokenMeter from '../src/index.ts'

describe('model usage projection', () => {
  it('separates actual routes, replaces settlement samples, and counts cached tokens once', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(TokenMeter)
      const session = ctx.sessions.create()
      const add = (provider: string, model: string, step: number, inputTokens: number) => session.append('assistant/message', {
        turn: 0, step, stream: [], usage: { inputTokens, outputTokens: 5, cacheReadTokens: 10, cacheWriteTokens: 2 },
        message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider, model } }),
      }, { surfaceOp: 'append' })
      add('anthropic', 'claude-sonnet-5-5', 0, 100)
      add('anthropic', 'claude-sonnet-5-5', 0, 120)
      add('anthropic', 'claude-sonnet-5-5', 0, 120)
      add('openai-codex', 'gpt-6.1-sol', 1, 50)
      expect(ctx.sessionProjections.snapshot(session).values.modelUsage).toEqual([
        { provider: 'anthropic', model: 'claude-sonnet-5-5', usage: { uncachedInputTokens: 120, outputTokens: 5, cacheReadTokens: 10, cacheWriteTokens: 2 } },
        { provider: 'openai-codex', model: 'gpt-6.1-sol', usage: { uncachedInputTokens: 50, outputTokens: 5, cacheReadTokens: 10, cacheWriteTokens: 2 } },
      ])
    } finally { await ctx.fiber.dispose() }
  })
  it('retains failed-attempt usage across a retry and model switch', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(TokenMeter)
      const session = ctx.sessions.create()
      const attempt = (inputTokens: number) => session.append('assistant/attempt', { turn: 0, step: 0,
        stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: { inputTokens, outputTokens: 1 } } }] })
      session.append('step/start', { turn: 0, step: 0 })
      attempt(999)
      session.append('request/header', { header: { config: { provider: 'anthropic', model: 'claude-sonnet-5-5' } }, reason: 'initial' })
      attempt(10)
      session.append('llm/retry-started', { retryId: RetryId('usage-switch'), turn: 0, step: 0, retry: 1 })
      attempt(20)
      session.append('request/header', { header: { config: { provider: 'openai-codex', model: 'gpt-6.1-sol' } }, reason: 'change' })
      attempt(30)
      const rows = ctx.sessionProjections.snapshot(session).values.modelUsage
      expect(rows?.map(row => [row.provider, row.usage.uncachedInputTokens, row.usage.outputTokens])).toEqual([
        ['anthropic', 30, 2], ['openai-codex', 30, 1],
      ])
    } finally { await ctx.fiber.dispose() }
  })

})
