import { describe, expect, it } from 'vitest'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { stepBudgetText, withStepBudget } from '../src/step-budget.ts'
import { SubagentRuntime } from '../src/index.ts'

const enter: PreStepDecision = { kind: 'enter', messages: [] }
const texts = (decision: PreStepDecision): string[] => decision.kind === 'enter'
  ? decision.messages.flatMap(message => message.content.map(block => block.type === 'text' ? block.text : ''))
  : []

describe('subagent step budget', () => {
  it('nudges a child once, on the budget step', () => {
    expect(texts(withStepBudget(enter, 2, 3, 1))).toEqual([])
    expect(texts(withStepBudget(enter, 3, 3, 1))).toEqual([stepBudgetText(3)])
    expect(texts(withStepBudget(enter, 4, 3, 1))).toEqual([])
  })

  it('leaves top-level agents, a zero budget, and rejected steps alone', () => {
    expect(texts(withStepBudget(enter, 3, 3, 0))).toEqual([])
    expect(texts(withStepBudget(enter, 0, 0, 1))).toEqual([])
    expect(withStepBudget({ kind: 'reject' }, 3, 3, 1)).toEqual({ kind: 'reject' })
  })

  it('defaults the runtime budget to 40 steps', () => {
    expect(SubagentRuntime.Config({}).stepBudget.get()).toBe(40)
  })
})
