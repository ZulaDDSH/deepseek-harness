import { Context } from '@deepseek-ai/cordis'
import type { AuthorizationEntryView } from '@deepseek-ai/dsh-api-settings-controller/types'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createAuthorizationOperations } from '../src/client/authorization-operations.ts'
import type { AttemptStreamItem, AuthorizationOperations } from '../src/client/authorization-operations.ts'

async function setup(items: AttemptStreamItem[] = []) {
  const root = new Context()
  onTestFinished(() => root.fiber.dispose())
  const namespace = {
    list: vi.fn<() => Promise<
      { ok: true; value: AuthorizationEntryView[] } | { ok: false; error: { message: string } }
    >>().mockResolvedValue({ ok: true, value: [] }),
    begin: vi.fn((_key: string, _method: string | undefined, _signal: AbortSignal) => (
      (async function* () { yield* items })()
    )),
    answer: vi.fn<(_attempt: string, _prompt: string, _value: string) => Promise<
      { ok: true; value: undefined } | { ok: false; error: { message: string } }
    >>().mockResolvedValue({ ok: true, value: undefined }),
    cancel: vi.fn(async (_attempt: string) => ({ ok: true, value: undefined })),
  }
  root.provide('remote.authorization', namespace)
  root.accessor('remote', {
    get() {
      const consumer = this
      return Object.defineProperty({}, 'authorization', {
        get: () => Reflect.get(consumer, 'remote.authorization'),
      })
    },
  })
  let operations: AuthorizationOperations | undefined
  await root.plugin({
    apply(ctx: Context) {
      expect(ctx.get('remote.authorization')).toBeDefined()
      operations = createAuthorizationOperations(ctx)
    },
  }).await()
  if (operations === undefined) throw new Error('Authorization callbacks did not mount')
  return { operations, namespace }
}

describe('optional authorization callbacks', () => {
  it('lists the resolved namespace without requiring the guarded remote accessor', async () => {
    const { operations, namespace } = await setup()
    const entries: AuthorizationEntryView[] = [{
      key: 'provider/key', label: 'Provider', methods: [], inFlight: false, configured: false,
    }]
    namespace.list.mockResolvedValue({ ok: true, value: entries })
    await expect(operations.list()).resolves.toEqual(entries)
    namespace.list.mockResolvedValue({ ok: false, error: { message: 'unavailable' } })
    await expect(operations.list()).resolves.toEqual([])
  })

  it.each(['authorized', 'cancelled'] as const)('forwards every stream item and reports %s', async (status) => {
    const items: AttemptStreamItem[] = [
      { type: 'start', attempt: 'capability', key: 'provider/key' },
      { type: 'notice', attempt: 'capability', message: 'Continue sign-in' },
      { type: 'end', status },
    ]
    const { operations, namespace } = await setup(items)
    const signal = new AbortController().signal
    const onItem = vi.fn()
    await expect(operations.begin('provider/key', 'oauth', onItem, signal)).resolves.toEqual({ kind: status })
    expect(namespace.begin).toHaveBeenCalledWith('provider/key', 'oauth', signal)
    expect(onItem.mock.calls.map(([item]) => item)).toEqual(items)
  })

  it('treats a stream without a terminal item as cancelled', async () => {
    const { operations } = await setup()
    await expect(operations.begin('provider/key', undefined, vi.fn(), new AbortController().signal))
      .resolves.toEqual({ kind: 'cancelled' })
  })

  it.each([new Error('grant refused'), 'carrier closed'])('retains stream failure diagnostics: %s', async (failure) => {
    const { operations, namespace } = await setup()
    namespace.begin.mockImplementation(() => (
      (async function* (): AsyncGenerator<AttemptStreamItem> { throw failure })()
    ))
    await expect(operations.begin('provider/key', undefined, vi.fn(), new AbortController().signal))
      .resolves.toEqual({ kind: 'failed', message: failure instanceof Error ? failure.message : failure })
  })

  it('forwards answers and preserves refusal messages', async () => {
    const { operations, namespace } = await setup()
    await expect(operations.answer('capability', 'question', 'code')).resolves.toEqual({ kind: 'accepted' })
    expect(namespace.answer).toHaveBeenCalledWith('capability', 'question', 'code')
    namespace.answer.mockResolvedValue({ ok: false, error: { message: 'question expired' } })
    await expect(operations.answer('capability', 'question', 'code'))
      .resolves.toEqual({ kind: 'refused', message: 'question expired' })
  })

  it('forwards withdrawal and does not swallow transport failures', async () => {
    const { operations, namespace } = await setup()
    await expect(operations.cancel('capability')).resolves.toBeUndefined()
    expect(namespace.cancel).toHaveBeenCalledWith('capability')
    namespace.cancel.mockRejectedValue(new Error('carrier closed'))
    await expect(operations.cancel('capability')).rejects.toThrow('carrier closed')
  })
})
