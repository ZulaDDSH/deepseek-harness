import { describe, expect, it } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SESSION_RUN_OPTION_EFFORTS } from '@deepseek-ai/dsh-api-session-controller/types'
import { EFFORT_LEVELS, claudeRunSelectionOf } from '../src/run-selection.ts'

describe('claudeRunSelectionOf', () => {
  it('names nothing without agent options', () => {
    expect(claudeRunSelectionOf(undefined)).toEqual({})
  })

  it('accepts exactly the Session run-option effort levels', () => {
    expect([...EFFORT_LEVELS]).toEqual([...SESSION_RUN_OPTION_EFFORTS])
  })

  it('accepts Claude Code aliases and model ids, with a Claude Code effort level', () => {
    expect(claudeRunSelectionOf({ model: 'opus[1m]', reasoningEffort: ReasoningEffortId('xhigh') }))
      .toEqual({ model: 'opus[1m]', effort: 'xhigh' })
    expect(claudeRunSelectionOf({ model: 'claude-sonnet-5-5' })).toEqual({ model: 'claude-sonnet-5-5' })
  })

  it('accepts date-suffixed Claude model ids', () => {
    expect(claudeRunSelectionOf({ model: 'claude-opus-4-5-20251101' })).toEqual({ model: 'claude-opus-4-5-20251101' })
    expect(claudeRunSelectionOf({ model: 'claude-sonnet-4-20250514' })).toEqual({ model: 'claude-sonnet-4-20250514' })
  })

  it('rejects a malformed date suffix', () => {
    expect(() => claudeRunSelectionOf({ model: 'claude-opus-4-5-2025' })).toThrow('is not a Claude Code model alias or id')
    expect(() => claudeRunSelectionOf({ model: 'claude-opus-4-5-20251101-x' })).toThrow('is not a Claude Code model alias or id')
  })

  it('rejects a model outside the Claude Code list', () => {
    expect(() => claudeRunSelectionOf({ model: 'not-a-claude-model' }))
      .toThrow('"not-a-claude-model" is not a Claude Code model alias or id')
  })

  it('rejects an effort outside the Claude Code levels', () => {
    expect(() => claudeRunSelectionOf({ reasoningEffort: ReasoningEffortId('turbo') }))
      .toThrow('reasoning effort "turbo" is not a Claude Code effort level')
  })

  it('rejects a provider or token limit, which one Claude Code child cannot set', () => {
    expect(() => claudeRunSelectionOf({ provider: 'other', model: 'opus' }))
      .toThrow('may set only model and reasoningEffort')
    expect(() => claudeRunSelectionOf({ maxTokens: 512 })).toThrow('may set only model and reasoningEffort')
  })
})
