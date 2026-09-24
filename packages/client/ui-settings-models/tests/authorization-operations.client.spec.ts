import { describe, expect, it, vi } from 'vitest'
import { createAuthorizationOperations } from '../src/client/authorization-operations.ts'

function remote(overrides: Record<string, unknown> = {}) {
  return {
    list: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    begin: async function* () {
      yield { type: 'start', attempt: 'attempt-1', key: 'provider/key' }
      yield { type: 'end', status: 'authorized' }
    },
    answer: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
    cancel: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as never
}

describe('authorization operations', () => {
  it('returns the available authorization entries and hides a refused listing', async () => {
    const entries = [{ key: 'provider/key', label: 'Provider', methods: [], configured: false, inFlight: false }]
    const available = createAuthorizationOperations(remote({
      list: vi.fn(() => Promise.resolve({ ok: true, value: entries })),
    }))
    const refused = createAuthorizationOperations(remote({
      list: vi.fn(() => Promise.resolve({ ok: false, error: { message: 'unavailable' } })),
    }))

    expect(await available.list()).toEqual(entries)
    expect(await refused.list()).toEqual([])
  })

  it('streams one attempt and reports authorized or cancelled settlement', async () => {
    const seen: unknown[] = []
    const authorized = createAuthorizationOperations(remote())
    const cancelled = createAuthorizationOperations(remote({
      begin: async function* () {
        yield { type: 'start', attempt: 'attempt-2', key: 'provider/key' }
        yield { type: 'end', status: 'cancelled' }
      },
    }))
    const noTerminal = createAuthorizationOperations(remote({
      begin: async function* () {
        yield { type: 'start', attempt: 'attempt-3', key: 'provider/key' }
      },
    }))

    expect(await authorized.begin('provider/key', 'oauth', item => seen.push(item), new AbortController().signal))
      .toEqual({ kind: 'authorized' })
    expect(seen).toHaveLength(2)
    expect(await cancelled.begin('provider/key', undefined, () => {}, new AbortController().signal))
      .toEqual({ kind: 'cancelled' })
    expect(await noTerminal.begin('provider/key', undefined, () => {}, new AbortController().signal))
      .toEqual({ kind: 'cancelled' })
  })

  it('turns stream exceptions into failed outcomes without copying exception types', async () => {
    const errorFailure = createAuthorizationOperations(remote({
      begin: async function* () {
        throw new Error('provider failed')
      },
    }))
    const valueFailure = createAuthorizationOperations(remote({
      begin: async function* () {
        throw 'provider failed as text'
      },
    }))

    expect(await errorFailure.begin('provider/key', undefined, () => {}, new AbortController().signal))
      .toEqual({ kind: 'failed', message: 'provider failed' })
    expect(await valueFailure.begin('provider/key', undefined, () => {}, new AbortController().signal))
      .toEqual({ kind: 'failed', message: 'provider failed as text' })
  })

  it('maps accepted and refused answers and forwards cancellation', async () => {
    const cancel = vi.fn(() => Promise.resolve())
    const accepted = createAuthorizationOperations(remote({ cancel }))
    const refused = createAuthorizationOperations(remote({
      answer: vi.fn(() => Promise.resolve({ ok: false, error: { message: 'question closed' } })),
    }))

    expect(await accepted.answer('attempt-1', 'prompt-1', 'answer')).toEqual({ kind: 'accepted' })
    expect(await refused.answer('attempt-1', 'prompt-1', 'answer'))
      .toEqual({ kind: 'refused', message: 'question closed' })

    await accepted.cancel('attempt-1')
    expect(cancel).toHaveBeenCalledWith('attempt-1')
  })
})
