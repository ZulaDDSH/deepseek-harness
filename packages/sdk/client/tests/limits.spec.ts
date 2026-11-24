import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  NotificationOverflowError,
  TransportClosedError,
  type HarnessClient,
} from '../src/index.ts'
import { STDERR_LINE_LIMIT, STDERR_TAIL_CHARS, SUBSCRIPTION_QUEUE_LIMIT, createProcessHarnessClient } from '../src/client.ts'

const fakeRuntime = fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))
const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup().catch(() => undefined)))
})

function fakeClient(env: Record<string, string>): HarnessClient {
  const client = createProcessHarnessClient({
    command: process.execPath,
    args: [fakeRuntime],
    environment: () => ({ ...process.env as Record<string, string>, ...env }),
    description: 'scripted fake runtime',
    initializeTimeoutMs: 5_000,
    disposeEofGraceMs: 1_000,
    disposeGraceMs: 1_000,
  })
  cleanups.push(() => client.close())
  return client
}

async function initializeFailure(client: HarnessClient): Promise<string> {
  const failure = await client.initialize({ cwd: process.cwd(), provider: 'p', model: 'm' }).then(
    () => { throw new Error('initialize unexpectedly succeeded') },
    (error: unknown) => error,
  )
  return String(failure)
}

describe('SDK stderr byte bound', () => {
  it('truncates one very long unterminated stderr line', async () => {
    const client = fakeClient({ FAKE_STDERR_BULK: '8,1000000,0', FAKE_EXIT_BEFORE_INIT: '1' })
    const text = await initializeFailure(client)
    expect(text).toContain('...[truncated]')
    expect(text.length).toBeLessThan(STDERR_LINE_LIMIT + 2_000)
  })

  it('keeps the newest large lines within the retained byte tail', async () => {
    const client = fakeClient({ FAKE_STDERR_BULK: '450,20000,1', FAKE_EXIT_BEFORE_INIT: '1' })
    const text = await initializeFailure(client)
    expect(text).toContain('449:')
    expect(text).not.toContain('\n0:')
    expect(text.length).toBeLessThan(STDERR_TAIL_CHARS + 2_000)
  })
})

describe('SDK notification queue bound', () => {
  it('fails an unread subscription visibly after the queue limit and keeps queued items drainable', async () => {
    const client = fakeClient({})
    const slow = client.subscribe()
    const other = client.subscribe()
    const dispatch = client
    for (let index = 0; index < SUBSCRIPTION_QUEUE_LIMIT; index += 1) {
      dispatch['dispatchNotification']({ method: 'tick', params: { index } })
      other.tryNext()
    }
    dispatch['dispatchNotification']({ method: 'tick', params: { index: SUBSCRIPTION_QUEUE_LIMIT } })
    dispatch['dispatchNotification']({ method: 'tick', params: { index: SUBSCRIPTION_QUEUE_LIMIT + 1 } })

    expect(other.tryNext()).toEqual({ method: 'tick', params: { index: SUBSCRIPTION_QUEUE_LIMIT } })
    expect(other.tryNext()).toEqual({ method: 'tick', params: { index: SUBSCRIPTION_QUEUE_LIMIT + 1 } })
    let drained = 0
    while (slow.tryNext() !== undefined) drained += 1
    expect(drained).toBe(SUBSCRIPTION_QUEUE_LIMIT)
    await expect(slow.next()).rejects.toBeInstanceOf(NotificationOverflowError)
  })
})

describe('SDK transport failure', () => {
  it('fails subscriptions and reaps the runtime when the runtime sends an oversized frame', async () => {
    const client = fakeClient({ FAKE_OVERSIZE_STDOUT: '1' })
    client.start()
    const subscription = client.subscribe()

    await expect(subscription.next()).rejects.toBeInstanceOf(TransportClosedError)
    await expect(subscription.next()).rejects.toThrow('JSON-RPC frame exceeds')
    await client.close()
  }, 30_000)
})
