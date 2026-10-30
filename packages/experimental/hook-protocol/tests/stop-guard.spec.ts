import { describe, expect, it } from 'vitest'
import { createStopLoopGuard, DEFAULT_MAX_FORCED_STOPS } from '@deepseek-ai/dsh-hook-protocol'

describe('createStopLoopGuard', () => {
  it('exposes a default per-turn cap', () => {
    expect(DEFAULT_MAX_FORCED_STOPS).toBe(3)
  })

  it('admits at most maxForcedStops continuations per agent turn', () => {
    const guard = createStopLoopGuard(3)
    const agent = {}
    expect(guard.active(agent, 1)).toBe(false)
    expect(guard.admit(agent, 1)).toBe(true)
    expect(guard.active(agent, 1)).toBe(true)
    expect(guard.admit(agent, 1)).toBe(true)
    expect(guard.admit(agent, 1)).toBe(true)
    expect(guard.admit(agent, 1)).toBe(false)
  })

  it('resets on a new turn number', () => {
    const guard = createStopLoopGuard(1)
    const agent = {}
    expect(guard.admit(agent, 1)).toBe(true)
    expect(guard.admit(agent, 1)).toBe(false)
    expect(guard.active(agent, 2)).toBe(false)
    expect(guard.admit(agent, 2)).toBe(true)
  })

  it('keeps each agent object independent', () => {
    const guard = createStopLoopGuard(3)
    const a = {}
    const b = {}
    expect(guard.admit(a, 1)).toBe(true)
    expect(guard.active(b, 1)).toBe(false)
  })

  it('a cap of one admits the first continuation only', () => {
    const guard = createStopLoopGuard(1)
    const agent = {}
    expect(guard.admit(agent, 5)).toBe(true)
    expect(guard.admit(agent, 5)).toBe(false)
  })
})
