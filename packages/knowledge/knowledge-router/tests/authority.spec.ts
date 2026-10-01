/**
 * Authority over the learning write: a session that was started by another
 * session is a worker, and only a session that started no worker of its own,
 * or that owns the finding itself, may record learned knowledge.
 */

import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { assertSupervisor, isWorker } from '../src/authority.ts'

/** An agent whose session header records the given parent, when one is given. */
function agent(parentSession?: SessionId): Agent {
  const header = parentSession === undefined ? {} : { parentSession }
  return { session: { header } } as unknown as Agent
}

describe('isWorker', () => {
  it('classifies a session that another session started as a worker', () => {
    expect(isWorker(agent(SessionId('parent')))).toBe(true)
  })

  it('classifies a root session and an absent caller as no worker', () => {
    expect(isWorker(agent())).toBe(false)
    expect(isWorker(undefined)).toBe(false)
  })
})

describe('assertSupervisor', () => {
  it('refuses a delegated worker', () => {
    expect(() => { assertSupervisor(agent(SessionId('parent')), 'record learned knowledge') })
      .toThrow('delegated worker may not record learned knowledge')
  })

  it('names the operation the worker was refused', () => {
    expect(() => { assertSupervisor(agent(SessionId('parent')), 'supersede a lesson') })
      .toThrow('may not supersede a lesson')
  })

  it('admits a root session and an absent caller', () => {
    expect(() => { assertSupervisor(agent(), 'record learned knowledge') }).not.toThrow()
    expect(() => { assertSupervisor(undefined, 'record learned knowledge') }).not.toThrow()
  })
})
