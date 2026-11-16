import { describe, expect, it } from 'vitest'
import { claudeCliUltracodeSupported, ultracodeSupported } from '@deepseek-ai/dsh-llm'

describe('ultracodeSupported', () => {
  it('declares Ultracode for every current Claude 5 family model id', () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']) {
      expect(ultracodeSupported(model)).toBe(true)
    }
  })

  it('declares no Ultracode for other models, aliases, or older Claude models', () => {
    for (const model of ['claude-opus-4-5', 'claude-opus-5', 'claude-opus-4-1', 'gpt-5.5', 'gpt-6.1-sol', 'deepseek-v4-pro', 'opus', 'haiku[1m]', 'best', 'opusplan']) {
      expect(ultracodeSupported(model)).toBe(false)
    }
  })
})

describe('claudeCliUltracodeSupported', () => {
  it('accepts the Claude CLI aliases of every family model, with and without [1m]', () => {
    for (const alias of ['opus', 'opus[1m]', 'sonnet', 'sonnet[1m]', 'haiku', 'haiku[1m]', 'fable', 'fable[1m]']) {
      expect(claudeCliUltracodeSupported(alias)).toBe(true)
      expect(ultracodeSupported(alias)).toBe(false)
    }
  })

  it('accepts the full ids and dated ids of every family model', () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']) {
      expect(claudeCliUltracodeSupported(model)).toBe(true)
    }
    expect(claudeCliUltracodeSupported('claude-opus-5-5-20261001')).toBe(true)
    expect(claudeCliUltracodeSupported('claude-sonnet-5-5-20261001')).toBe(true)
    expect(claudeCliUltracodeSupported('claude-haiku-5-5-20261001')).toBe(true)
    expect(claudeCliUltracodeSupported('claude-fable-5-1-20261001')).toBe(true)
  })

  it('rejects older Claude models, malformed ids, other providers, and selector names', () => {
    for (const model of ['claude-opus-4-5', 'claude-opus-4-1', 'claude-opus-5-5-x', 'claude-opus-5-5-2026101', 'gpt-5.5', 'deepseek-v4-pro', 'best', 'opusplan', 'sonnet[2m]']) {
      expect(claudeCliUltracodeSupported(model)).toBe(false)
    }
  })
})
