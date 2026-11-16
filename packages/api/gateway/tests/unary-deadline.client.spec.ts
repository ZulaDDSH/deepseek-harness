import { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { InvocationDescriptor, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, Config, inject } from '../src/client/index.ts'

type CallMock = ReturnType<typeof vi.fn<ConnectionHandle['rpc']['call']>>

interface DeadlineNamespace {
  ping(...args: unknown[]): Promise<RemoteResult<unknown>>
}

const PING: InvocationDescriptor = {
  id: '@fixture/deadline#deadline/ping',
  service: 'deadline',
  namespace: 'deadline',
  method: 'ping',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'src-json' },
}

const roots: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) await root.fiber.dispose()
})

function neverAnswers(): CallMock {
  return vi.fn<ConnectionHandle['rpc']['call']>(() => new Promise<never>(() => {}))
}

async function bench(
  call: CallMock,
  descriptor: InvocationDescriptor = PING,
  config?: Config,
): Promise<DeadlineNamespace> {
  const root = new Context()
  roots.push(root)
  await root.plugin(TypertRegistry)
  const connection: Pick<ConnectionHandle, 'rpc' | 'registerGenerationSource' | 'start'> = {
    rpc: { call, open: () => { throw new Error('unused') } },
    registerGenerationSource: () => () => {},
    start: () => ({ stop: () => {} }),
  }
  root.provide('connection', connection as ConnectionHandle)
  await root.plugin({ inject, apply, Config }, config)
  await root.remote.$mount({ package: '@fixture/deadline', descriptors: [descriptor] })
  return root.get('remote.deadline') as DeadlineNamespace
}

function settleInto(promise: Promise<RemoteResult<unknown>>): { current: () => RemoteResult<unknown> | undefined } {
  let settled: RemoteResult<unknown> | undefined
  void promise.then((result) => { settled = result })
  return { current: () => settled }
}

describe('unary deadline', () => {
  it('folds an unanswered unary call into gateway/internal after 30 s and aborts its signal', async () => {
    const call = neverAnswers()
    const ping = await bench(call)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const outcome = settleInto(ping.ping())
    await vi.advanceTimersByTimeAsync(29_999)
    expect(outcome.current()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(outcome.current()).toMatchObject({
      ok: false,
      error: { code: 'gateway/internal', message: 'client api: deadline/ping did not answer within 30000ms' },
    })
    expect(call.mock.calls[0]?.[3]?.aborted).toBe(true)
  })

  it('honors a configured unaryDeadlineMs', async () => {
    const ping = await bench(neverAnswers(), PING, { unaryDeadlineMs: 50 })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const outcome = settleInto(ping.ping())
    await vi.advanceTimersByTimeAsync(49)
    expect(outcome.current()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(outcome.current()).toMatchObject({
      ok: false,
      error: { code: 'gateway/internal', message: 'client api: deadline/ping did not answer within 50ms' },
    })
  })

  it('leaves a cancellation-aware unary method without a deadline', async () => {
    const call = neverAnswers()
    const ping = await bench(call, { ...PING, cancellation: { parameter: 'signal' } })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const outcome = settleInto(ping.ping())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(outcome.current()).toBeUndefined()
    expect(call.mock.calls[0]?.[3]?.aborted).toBe(false)
  })

  it('delivers the answer of a cancellation-aware method that outlives the default deadline', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>(() => new Promise<RemoteResult<unknown>>((resolve) => {
      setTimeout(() => { resolve({ ok: true, value: 'installed' }) }, 45_000)
    }))
    const ping = await bench(call, { ...PING, cancellation: { parameter: 'signal' } })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const outcome = settleInto(ping.ping())
    await vi.advanceTimersByTimeAsync(45_000)
    expect(outcome.current()).toEqual({ ok: true, value: 'installed' })
  })

  it('clears the deadline timer once the call settles', async () => {
    const call = vi.fn<ConnectionHandle['rpc']['call']>(async () => ({ ok: true as const, value: 1 }))
    const ping = await bench(call)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await expect(ping.ping()).resolves.toEqual({ ok: true, value: 1 })
    expect(vi.getTimerCount()).toBe(0)
  })
})
