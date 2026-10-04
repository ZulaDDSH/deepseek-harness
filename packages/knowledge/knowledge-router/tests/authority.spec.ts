/**
 * Authority over the learning write: a session that was started by another
 * session is a worker, and only a session that started no worker of its own,
 * or that owns the finding itself, may record learned knowledge.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { assertSupervisor, isWorker } from '../src/authority.ts'

let context: Context
let rootAgent: Agent
let workerAgent: Agent

beforeAll(async () => {
  context = new Context()
  await mountAgentLoopTestDependencies(context)
  await mountAgentLoopTestHarness(context)
  const root = await context.agents.create({
    sessionId: SessionId('knowledge-authority-root'),
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  rootAgent = root.agent
  const worker = await context.agents.create({
    sessionId: SessionId('knowledge-authority-worker'),
    parentAgent: rootAgent,
    meta: { parentSession: rootAgent.id, origin: 'subagent', delegationDepth: 1 },
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  workerAgent = worker.agent
})

afterAll(async () => {
  await context?.fiber.dispose()
})

describe('isWorker', () => {
  it('classifies a session that another session started as a worker', () => {
    expect(isWorker(workerAgent)).toBe(true)
  })

  it('classifies a root session and an absent caller as no worker', () => {
    expect(isWorker(rootAgent)).toBe(false)
    expect(isWorker(undefined)).toBe(false)
  })
})

describe('assertSupervisor', () => {
  it('refuses a delegated worker', () => {
    expect(() => { assertSupervisor(workerAgent, 'record learned knowledge') })
      .toThrow('delegated worker may not record learned knowledge')
  })

  it('names the operation the worker was refused', () => {
    expect(() => { assertSupervisor(workerAgent, 'supersede a lesson') })
      .toThrow('may not supersede a lesson')
  })

  it('admits a root session and an absent caller', () => {
    expect(() => { assertSupervisor(rootAgent, 'record learned knowledge') }).not.toThrow()
    expect(() => { assertSupervisor(undefined, 'record learned knowledge') }).not.toThrow()
  })
})
