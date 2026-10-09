import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as jevPlugin from '../src/index.ts'
import { jevDecisionProjection } from '../src/projection.ts'
import type { JevDecisionRecord } from '../src/types.ts'

const decision = (data: SessionEvent['data']): SessionEvent => ({ type: 'jev/decision', data, time: 1 }) as SessionEvent

it('keeps the latest Jev decision and ignores other events', () => {
  const { init, apply, stateSchema, wire } = jevDecisionProjection
  const routed = { turn: 1, step: 1, choice: 'small', confidence: 0.9, provider: 'target', model: 'small' }
  const failed = { turn: 2, step: 1, error: 'timeout' }
  let state: JevDecisionRecord | null = init()
  expect(state).toBeNull()
  state = apply(state, decision(routed))
  expect(state).toEqual(routed)
  const unchanged = apply(state, { type: 'turn/start', data: { turn: 3 }, time: 2 } as SessionEvent)
  expect(unchanged).toBe(state)
  state = apply(state, decision(failed))
  expect(wire.view(state)).toEqual(failed)
  expect(stateSchema.parse(routed)).toEqual(routed)
  expect(stateSchema.parse(null)).toBeNull()
  expect(() => stateSchema.parse({ ...routed, extra: true })).toThrow()
})

it('stores the failure outcome under a bumped state version', () => {
  const { init, apply, stateSchema, stateVersion, wire } = jevDecisionProjection
  const stopped = { turn: 3, step: 1, error: 'offline', rejected: true }
  expect(stateVersion).toBe(2)
  const state = apply(init(), decision(stopped))
  expect(state).toEqual(stopped)
  expect(stateSchema.parse(state)).toEqual(stopped)
  expect(wire.view(state)).toEqual(stopped)
  expect(wire.viewSchema.parse(wire.view(state))).toEqual(stopped)
})

it('registers the projection once the projection registry is available', async () => {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(jevPlugin, {
    enabled: false, apiKeyEnv: 'JEV_TEST_KEY', endpoint: 'https://jev.example.test/v1', model: 'jev-test',
    timeoutMs: 1000, minConfidence: 0.8, stateMaxChars: 1000, fallback: 'keep', failOpen: true, routes: [],
  })
  const register = vi.fn(() => () => {})
  ctx.provide('sessionProjections', { register, stateOf: () => undefined } as never)
  await vi.waitFor(() => { expect(register).toHaveBeenCalledWith(jevDecisionProjection) })
  await ctx.fiber.dispose()
})
