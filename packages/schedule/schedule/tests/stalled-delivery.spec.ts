/** A delivery whose Session activation or flush never settles must not block unrelated schedule management. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import { DELIVERY_STEP_TIMEOUT_MS } from '../src/runtime.ts'
import { agentFor, harness, taskTable } from './harness.ts'

const tests: Awaited<ReturnType<typeof harness>>[] = []
const STALLED = brandString<SessionId>('stalled')
const OTHER = brandString<SessionId>('other')
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime('2026-09-16T00:00:00Z') })
afterEach(async () => {
  const disposing = Promise.all(tests.splice(0).map(test => test.ctx.fiber.dispose()))
  await vi.advanceTimersByTimeAsync(10_000)
  await disposing
  vi.restoreAllMocks(); vi.useRealTimers()
})

async function setup() {
  const test = await harness()
  tests.push(test)
  const stalled = agentFor(test.ctx, STALLED)
  const other = agentFor(test.ctx, OTHER)
  const activation = Promise.withResolvers<{ agent: Agent }>()
  test.resolve.mockImplementation(async sessionId => sessionId === STALLED ? activation.promise : { agent: other })
  const due = await test.service.create({
    title: 'Due', prompt: 'Due prompt', timing: { kind: 'every', every_seconds: 300 }, target: { kind: 'session', sessionId: STALLED },
  })
  return { ...test, stalled, other, activation, due }
}

async function within<T>(operation: Promise<T>, ms = 1_000): Promise<T> {
  let settled = false
  void operation.then(() => { settled = true }, () => { settled = true })
  await vi.advanceTimersByTimeAsync(ms)
  expect(settled).toBe(true)
  return operation
}

describe('stalled Session activation', () => {
  it('keeps create, catalog, update and delete of other tasks responsive', async () => {
    const test = await setup()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(test.resolve).toHaveBeenCalledWith(STALLED)
    const created = await within(test.service.create({
      title: 'Other', prompt: 'Other prompt', timing: { kind: 'every', every_seconds: 3_600 }, target: { kind: 'session', sessionId: OTHER },
    }))
    expect(await within(test.service.catalog())).toHaveLength(2)
    expect(await within(test.service.edit({ id: created.id, action: 'update', patch: { active: false } }))).toMatchObject({ status: 'paused' })
    expect(await within(test.service.edit({ id: created.id, action: 'delete' }))).toEqual({ id: created.id, deleted: true })
    expect(test.stalled.followup).not.toHaveBeenCalled()
  })

  it('delivers nothing to a task paused while its activation was pending', async () => {
    const test = await setup()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(await within(test.service.edit({ id: test.due.id, action: 'update', patch: { active: false } }))).toMatchObject({ status: 'paused' })
    test.activation.resolve({ agent: test.stalled })
    await vi.advanceTimersByTimeAsync(0)
    expect(test.stalled.followup).not.toHaveBeenCalled()
    expect(taskTable(test.ctx).get(test.due.id)).toMatchObject({ status: 'paused' })
    expect(taskTable(test.ctx).get(test.due.id)?.lastDelivery).toBeUndefined()
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(test.stalled.followup).not.toHaveBeenCalled()
  })

  it('does not recreate a task deleted while its activation was pending', async () => {
    const test = await setup()
    await vi.advanceTimersByTimeAsync(300_000)
    await within(test.service.edit({ id: test.due.id, action: 'delete' }))
    test.activation.resolve({ agent: test.stalled })
    await vi.advanceTimersByTimeAsync(0)
    expect(test.stalled.followup).not.toHaveBeenCalled()
    expect(await test.service.catalog()).toEqual([])
  })

  it('abandons the activation at the deadline and delivers the same occurrence once on retry', async () => {
    const test = await setup()
    const warn = vi.spyOn(test.ctx.logger, 'warn')
    await vi.advanceTimersByTimeAsync(300_000)
    await vi.advanceTimersByTimeAsync(DELIVERY_STEP_TIMEOUT_MS)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('delivery step exceeded'))
    expect(test.stalled.followup).not.toHaveBeenCalled()
    test.resolve.mockImplementation(async () => ({ agent: test.stalled }))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(test.stalled.followup).toHaveBeenCalledTimes(1)
    expect(taskTable(test.ctx).get(test.due.id)?.lastDelivery).toMatchObject({ scheduledAt: '2026-09-16T00:05:00.000Z' })
  })

  it('lets disposal finish without waiting for the activation', async () => {
    const test = await setup()
    await vi.advanceTimersByTimeAsync(300_000)
    await test.ctx.fiber.dispose()
    expect(test.stalled.followup).not.toHaveBeenCalled()
  })
})

describe('stalled Session flush', () => {
  it('keeps other management responsive and holds the slot until the deadline', async () => {
    const test = await setup()
    test.activation.resolve({ agent: test.stalled })
    test.flush.mockImplementation(() => new Promise<undefined>(() => {}))
    await vi.advanceTimersByTimeAsync(300_000)
    expect(test.stalled.followup).toHaveBeenCalledTimes(1)
    const created = await within(test.service.create({
      title: 'Other', prompt: 'Other prompt', timing: { kind: 'every', every_seconds: 3_600 }, target: { kind: 'session', sessionId: OTHER },
    }))
    expect(await within(test.service.edit({ id: created.id, action: 'delete' }))).toEqual({ id: created.id, deleted: true })
    expect(await within(test.service.view({ id: test.due.id }))).toMatchObject({ executionActive: true })
    expect(test.stalled.followup).toHaveBeenCalledTimes(1)
  })

  it('lets disposal wait only a short grace for a flush that never settles', async () => {
    const test = await setup()
    test.activation.resolve({ agent: test.stalled })
    test.flush.mockImplementation(() => new Promise<undefined>(() => {}))
    await vi.advanceTimersByTimeAsync(300_000)
    let disposed = false
    const disposing = test.ctx.fiber.dispose().then(() => { disposed = true })
    await vi.advanceTimersByTimeAsync(4_000)
    expect(disposed).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    await disposing
    expect(disposed).toBe(true)
  })

  it('commits no receipt for a task deleted during the flush', async () => {
    const test = await setup()
    test.activation.resolve({ agent: test.stalled })
    const flushed = Promise.withResolvers<undefined>()
    test.flush.mockImplementationOnce(() => flushed.promise)
    await vi.advanceTimersByTimeAsync(300_000)
    await within(test.service.edit({ id: test.due.id, action: 'delete' }))
    flushed.resolve(undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(await test.service.catalog()).toEqual([])
  })

  it('keeps a pause made during the flush while recording the delivery', async () => {
    const test = await setup()
    test.activation.resolve({ agent: test.stalled })
    const flushed = Promise.withResolvers<undefined>()
    test.flush.mockImplementationOnce(() => flushed.promise)
    await vi.advanceTimersByTimeAsync(300_000)
    await within(test.service.edit({ id: test.due.id, action: 'update', patch: { active: false } }))
    flushed.resolve(undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(taskTable(test.ctx).get(test.due.id)).toMatchObject({
      status: 'paused', record: { scheduledAt: '2026-09-16T00:05:00.000Z' }, lastDelivery: { scheduledAt: '2026-09-16T00:05:00.000Z' },
    })
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(test.stalled.followup).toHaveBeenCalledTimes(1)
  })
})

describe('changes and recovery around an in-flight delivery', () => {
  it('records the receipt and advances when the target changed during the flush instead of delivering again', async () => {
    const test = await setup()
    test.activation.resolve({ agent: test.stalled })
    const flushed = Promise.withResolvers<undefined>()
    test.flush.mockImplementationOnce(() => flushed.promise)
    await vi.advanceTimersByTimeAsync(300_000)
    await within(test.service.edit({ id: test.due.id, action: 'update', patch: { target: { kind: 'session', sessionId: OTHER } } }))
    flushed.resolve(undefined)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(test.stalled.followup).toHaveBeenCalledTimes(1)
    expect(test.other.followup).not.toHaveBeenCalled()
    expect(taskTable(test.ctx).get(test.due.id)).toMatchObject({
      target: { kind: 'session', sessionId: OTHER }, record: { scheduledAt: '2026-09-16T00:10:00.000Z' },
      lastDelivery: { scheduledAt: '2026-09-16T00:05:00.000Z', targetSessionId: STALLED },
    })
  })

  it('drains a manual run through its receipt commit when disposal starts during its flush', async () => {
    const test = await setup()
    test.activation.resolve({ agent: test.stalled })
    const flushed = Promise.withResolvers<undefined>()
    test.flush.mockImplementationOnce(() => flushed.promise)
    const running = test.service.run({ id: test.due.id })
    await vi.advanceTimersByTimeAsync(0)
    expect(test.stalled.followup).toHaveBeenCalledTimes(1)
    const disposing = test.ctx.fiber.dispose()
    await vi.advanceTimersByTimeAsync(1_000)
    flushed.resolve(undefined)
    await disposing
    expect(await running).toMatchObject({ id: test.due.id, lastDelivery: { targetSessionId: STALLED } })
  })

  it('fails the delivery when recovery of the last delivery stalls instead of enqueueing a second copy', async () => {
    const test = await setup()
    test.activation.resolve({ agent: test.stalled })
    await vi.advanceTimersByTimeAsync(300_000)
    expect(test.stalled.followup).toHaveBeenCalledTimes(1)
    test.resolve.mockImplementationOnce(() => new Promise(() => {}))
    await vi.advanceTimersByTimeAsync(300_000 + DELIVERY_STEP_TIMEOUT_MS + 1_000)
    expect(test.stalled.followup).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(test.stalled.followup).toHaveBeenCalledTimes(2)
  })

  it('delivers an unrelated due reminder once the stalled group reaches its deadline', async () => {
    const test = await setup()
    const unrelated = await test.service.create({
      title: 'Unrelated', prompt: 'Unrelated prompt', timing: { kind: 'every', every_seconds: 300 }, target: { kind: 'session', sessionId: OTHER },
    })
    await vi.advanceTimersByTimeAsync(300_000)
    expect(test.other.followup).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DELIVERY_STEP_TIMEOUT_MS)
    expect(test.other.followup).toHaveBeenCalledTimes(1)
    expect(taskTable(test.ctx).get(unrelated.id)?.lastDelivery).toMatchObject({ targetSessionId: OTHER })
  })
})
