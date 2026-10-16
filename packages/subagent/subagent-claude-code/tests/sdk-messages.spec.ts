import { describe, expect, it, vi } from 'vitest'
import type {
  SDKAssistantMessageError,
  SDKMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk'
import {
  assistantErrorDetail,
  sdkFailureCategory,
} from '../src/sdk-messages.ts'
import { consumeClaudeQuery, successfulResult } from '../src/run.ts'

const RESET_ISO = new Date(1760000000 * 1000).toISOString()

function result(subtype: string, isError = false): SDKResultMessage {
  return {
    type: 'result',
    subtype,
    is_error: isError,
    result: 'answer',
    errors: ['fixture failure'],
  } as never
}

function assistant(
  error?: SDKAssistantMessageError,
  content: unknown[] = [],
): SDKMessage {
  return { type: 'assistant', message: { content }, error } as SDKMessage
}

function rateLimit(resetsAt: number): SDKMessage {
  return {
    type: 'rate_limit_event',
    rate_limit_info: { status: 'rejected', resetsAt },
  } as SDKMessage
}

async function* stream(messages: readonly SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  for (const message of messages) yield message
}

async function rejectionOf(run: () => unknown): Promise<Error> {
  try {
    await run()
  } catch (error: unknown) {
    if (error instanceof Error) return error
  }
  throw new Error('expected a rejection')
}

describe('SDK failure classification', () => {
  it('classifies an observed authentication failure as access-policy inside a success subtype', () => {
    expect(() => successfulResult(result('success', true), { assistantError: 'authentication_failed' }))
      .toThrow('category: access-policy; detail: authentication_failed')
  })

  it('classifies billing_error as limit', () => {
    expect(() => successfulResult(result('success', true), { assistantError: 'billing_error' }))
      .toThrow('category: limit; detail: billing_error')
  })

  it('describes a rate limit with its reset time in seconds or milliseconds', () => {
    for (const resetsAt of [1760000000, 1760000000000]) {
      expect(() => successfulResult(result('success', true), { assistantError: 'rate_limit', resetsAt }))
        .toThrow(`detail: rate_limit, resets at ${RESET_ISO}`)
    }
  })

  it('classifies overload and server errors as service and model or request errors as product-error', () => {
    expect(() => successfulResult(result('success', true), { assistantError: 'overloaded' }))
      .toThrow('category: service')
    expect(() => successfulResult(result('success', true), { assistantError: 'model_not_found' }))
      .toThrow('category: product-error')
  })

  it('keeps the subtype category unless an observed error is more specific', async () => {
    expect(() => successfulResult(result('error_during_execution'), { assistantError: 'server_error' }))
      .toThrow('category: service')
    expect(() => successfulResult(result('error_max_turns'), { assistantError: 'rate_limit' }))
      .toThrow('category: limit; detail: rate_limit')
    const serverOnLimit = await rejectionOf(() => successfulResult(result('error_max_turns'), { assistantError: 'server_error' }))
    expect(serverOnLimit.message).toContain('category: limit')
    expect(serverOnLimit.message).not.toContain('detail:')
  })

  it('reports an is_error result without an observed error as invalid-result without detail', async () => {
    const error = await rejectionOf(() => successfulResult(result('success', true)))
    expect(error.message).toContain('category: invalid-result')
    expect(error.message).not.toContain('detail:')
  })

  it('reports an unmapped assistant error as invalid-result without detail', async () => {
    const error = await rejectionOf(() => successfulResult(result('success', true), { assistantError: 'unknown' }))
    expect(error.message).toContain('category: invalid-result')
    expect(error.message).not.toContain('detail:')
  })

  it('maps result subtypes to fixed categories', () => {
    expect(sdkFailureCategory('error_max_budget_usd')).toBe('limit')
    expect(sdkFailureCategory('future_failure')).toBe('unknown')
    expect(assistantErrorDetail('unknown')).toBeUndefined()
  })
})

describe('Claude Code stream observations', () => {
  it('hands each SDK rate-limit window to the observer and still resolves the answer', async () => {
    const onRateLimit = vi.fn()
    const window = {
      status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.92, resetsAt: 1760000000,
    }
    await expect(consumeClaudeQuery(stream([
      { type: 'rate_limit_event', rate_limit_info: window, uuid: '00000000-0000-4000-8000-000000000001', session_id: 's' } as SDKMessage,
      result('success'),
    ]), undefined, undefined, undefined, onRateLimit)).resolves.toMatchObject({
      stopReason: 'completed', output: [{ type: 'text', text: 'answer' }],
    })
    expect(onRateLimit).toHaveBeenCalledOnce()
    expect(onRateLimit).toHaveBeenCalledWith(window)
  })

  it('rejects with the observed rate limit and reset time', async () => {
    await expect(consumeClaudeQuery(stream([
      rateLimit(1760000000),
      assistant('rate_limit'),
      result('success', true),
    ]))).rejects.toThrow(`category: limit; detail: rate_limit, resets at ${RESET_ISO}`)
  })

  it('reports advisory tool-use lines and still resolves the answer', async () => {
    const onProgress = vi.fn()
    await expect(consumeClaudeQuery(stream([
      assistant(undefined, [
        { type: 'tool_use', id: '1', name: 'Edit', input: { file_path: 'src/a.ts' } },
        { type: 'tool_use', id: '2', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', id: '3', name: 'Grep', input: { pattern: 'foo' } },
        { type: 'tool_use', id: '4', name: 'Task', input: {} },
      ]),
      result('success'),
    ]), undefined, undefined, onProgress)).resolves.toEqual({
      output: [{ type: 'text', text: 'answer' }],
      stopReason: 'completed',
    })
    expect(onProgress.mock.calls).toEqual([
      ['Edit: src/a.ts'],
      ['Bash: ls'],
      ['Grep: foo'],
      ['Task'],
    ])
  })

  it('clears an earlier assistant error when a later assistant message has none', async () => {
    const error = await rejectionOf(() => consumeClaudeQuery(stream([
      assistant('rate_limit'),
      assistant(),
      result('success', true),
    ])))
    expect(error.message).toContain('category: invalid-result')
    expect(error.message).not.toContain('detail:')
  })
})
