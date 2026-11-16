/** Account Remote delegation preserves provider results, failures, and stream lifetime. */
import { Context } from '@deepseek-ai/cordis'
import type { DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account'
import type {
  AccountClientMetadata,
  AccountNotification,
  AccountNotificationBatch,
  AccountNotificationId,
} from '@deepseek-ai/dsh-deepseek-account/types'
import type { AccountView, SignInAttemptId } from '../src/types.ts'
import { afterEach, expect, it, vi } from 'vitest'
import AccountController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })
const state: AccountView = { status: 'signed-out', links: { usageUrl: 'https://platform.example/usage', topUpUrl: 'https://platform.example/top_up' }, attempt: null }
const client: AccountClientMetadata = { version: '0.0.0-test', locale: 'zh-CN', timezoneOffsetSeconds: 28_800 }

function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  const provider = {
    getState: vi.fn<DeepSeekAccount['getState']>().mockResolvedValue(state),
    getProfile: vi.fn<DeepSeekAccount['getProfile']>().mockResolvedValue({ status: 'failed' }),
    getBalance: vi.fn<DeepSeekAccount['getBalance']>().mockResolvedValue(null),
    getNotifications: vi.fn<DeepSeekAccount['getNotifications']>().mockResolvedValue(null),
    getNotificationContent: vi.fn<DeepSeekAccount['getNotificationContent']>().mockResolvedValue(null),
    reportNotificationEvent: vi.fn<DeepSeekAccount['reportNotificationEvent']>().mockResolvedValue(false),
    startSignIn: vi.fn<DeepSeekAccount['startSignIn']>().mockResolvedValue(state),
    cancelSignIn: vi.fn<DeepSeekAccount['cancelSignIn']>().mockResolvedValue(state),
    signOut: vi.fn<DeepSeekAccount['signOut']>().mockResolvedValue(state),
    watch: vi.fn<DeepSeekAccount['watch']>(),
  }
  ctx.provide('deepseekAccount', provider as never)
  return { ctx, provider, controller: new AccountController(ctx) }
}

it('delegates account operations without coupling profile and balance queries', async () => {
  const { provider, controller } = fixture()
  expect(await controller.getState()).toBe(state)
  expect(await controller.getProfile(client)).toEqual({ status: 'failed' })
  expect(provider.getBalance).not.toHaveBeenCalled()
  expect(await controller.getBalance(client)).toBeNull()
  expect(await controller.startSignIn(client, 'http://127.0.0.1:8080', 'desktop')).toBe(state)
  expect(provider.startSignIn).toHaveBeenCalledExactlyOnceWith(client, 'http://127.0.0.1:8080', 'desktop')
  const id = 'attempt' as SignInAttemptId
  expect(await controller.cancelSignIn(id)).toBe(state)
  expect(provider.cancelSignIn).toHaveBeenCalledExactlyOnceWith(id)
  expect(await controller.signOut(client)).toBe(state)
  expect(provider.signOut).toHaveBeenCalledExactlyOnceWith(client)
  const failure = new Error('storage unavailable')
  provider.signOut.mockRejectedValueOnce(failure)
  await expect(controller.signOut(client)).rejects.toBe(failure)
})

it('delegates notification reads and events without altering their values', async () => {
  const { provider, controller } = fixture()
  const id = 'notification' as AccountNotificationId
  const notification: AccountNotification = {
    id, createdAt: '2026-10-21T08:00:00Z', displayUntil: null,
    title: 'Account update', body: 'A notification.', actions: [],
  }
  const batch: AccountNotificationBatch = { nextPollAfterSeconds: 300, notifications: [notification] }
  provider.getNotifications.mockResolvedValueOnce(batch)
  expect(await controller.getNotifications(client)).toBe(batch)
  expect(provider.getNotifications).toHaveBeenCalledExactlyOnceWith(client)
  provider.getNotificationContent.mockResolvedValueOnce(notification)
  expect(await controller.getNotificationContent(id, client)).toBe(notification)
  expect(provider.getNotificationContent).toHaveBeenCalledExactlyOnceWith(id, client)
  provider.reportNotificationEvent.mockResolvedValueOnce(true)
  expect(await controller.reportNotificationEvent(id, 'displayed', client)).toBe(true)
  expect(provider.reportNotificationEvent).toHaveBeenCalledExactlyOnceWith(id, 'displayed', client)
  const failure = new Error('unavailable')
  provider.getNotifications.mockRejectedValueOnce(failure)
  await expect(controller.getNotifications(client)).rejects.toBe(failure)
})

it('passes the subscriber lifetime to the provider and returns its state stream', async () => {
  const { provider, controller } = fixture()
  const lifetime = new AbortController()
  const stream: AsyncIterable<AccountView> = { async *[Symbol.asyncIterator]() { yield state } }
  provider.watch.mockReturnValue(stream)
  expect(controller.watch(lifetime.signal)).toBe(stream)
  expect(provider.watch).toHaveBeenCalledExactlyOnceWith(lifetime.signal)
  const received: AccountView[] = []
  for await (const value of stream) received.push(value)
  expect(received).toEqual([state])
})

it('delivers expiry only to current subscribers and stops on disconnect', async () => {
  const { ctx, controller } = fixture()
  ctx.emit('deepseek-account/session-expired')
  const lifetime = new AbortController()
  const iterator = controller.watchExpiry(lifetime.signal)[Symbol.asyncIterator]()
  const first = iterator.next()
  ctx.emit('deepseek-account/session-expired')
  expect(await first).toEqual({ done: false, value: 'session-expired' })
  const next = iterator.next()
  lifetime.abort()
  expect(await next).toEqual({ done: true, value: undefined })
  const reconnect = new AbortController()
  const reopened = controller.watchExpiry(reconnect.signal)[Symbol.asyncIterator]().next()
  reconnect.abort()
  expect(await reopened).toEqual({ done: true, value: undefined })
})
