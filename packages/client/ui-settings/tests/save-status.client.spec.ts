import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAILED_NOTICE_MS, SAVED_NOTICE_MS, SaveStatusTracker } from '../src/client/save-status.ts'

afterEach(() => { vi.useRealTimers() })

describe('SaveStatusTracker', () => {
  it('saves, announces saved, then expires to idle', async () => {
    vi.useFakeTimers()
    const tracker = new SaveStatusTracker()
    const write = Promise.withResolvers<boolean>()
    expect(tracker.track(write.promise)).toBe(write.promise)
    expect(tracker.status.getSnapshot().state).toBe('saving')
    write.resolve(true)
    await write.promise
    expect(tracker.status.getSnapshot().state).toBe('saved')
    vi.advanceTimersByTime(SAVED_NOTICE_MS)
    expect(tracker.status.getSnapshot().state).toBe('idle')
  })

  it('stays saving until the whole batch settles and reports failure when any write failed', async () => {
    vi.useFakeTimers()
    const tracker = new SaveStatusTracker()
    const first = Promise.withResolvers<boolean>()
    const second = Promise.withResolvers<boolean>()
    void tracker.track(first.promise)
    void tracker.track(second.promise)
    first.resolve(false)
    await first.promise
    expect(tracker.status.getSnapshot().state).toBe('saving')
    second.resolve(true)
    await second.promise
    expect(tracker.status.getSnapshot().state).toBe('failed')
    vi.advanceTimersByTime(SAVED_NOTICE_MS)
    expect(tracker.status.getSnapshot().state).toBe('failed')
    vi.advanceTimersByTime(FAILED_NOTICE_MS)
    expect(tracker.status.getSnapshot().state).toBe('idle')
  })

  it('counts a rejected write as failed and a new write cancels the pending expiry', async () => {
    vi.useFakeTimers()
    const tracker = new SaveStatusTracker()
    const rejected = Promise.reject(new Error('offline')) as Promise<boolean>
    rejected.catch(() => {})
    void tracker.track(rejected)
    await vi.advanceTimersByTimeAsync(0)
    expect(tracker.status.getSnapshot().state).toBe('failed')
    const next = Promise.withResolvers<boolean>()
    void tracker.track(next.promise)
    vi.advanceTimersByTime(FAILED_NOTICE_MS)
    expect(tracker.status.getSnapshot().state).toBe('saving')
    next.resolve(true)
    await next.promise
    expect(tracker.status.getSnapshot().state).toBe('saved')
    tracker.dispose()
    vi.advanceTimersByTime(SAVED_NOTICE_MS)
    expect(tracker.status.getSnapshot().state).toBe('saved')
  })
})
