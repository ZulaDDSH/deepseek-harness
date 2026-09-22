import type { IpcMainInvokeEvent } from 'electron'
import { expect, it } from 'vitest'
import { assertDesktopSender, parseDesktopAttentionRequest } from '../src/ipc.ts'

it('accepts valid application attention requests and rejects invalid or unowned calls', () => {
  const valid = { sessionId: 's1', title: 'Background task', kind: 'question' }
  expect(parseDesktopAttentionRequest(valid)).toEqual(valid)
  expect(() => parseDesktopAttentionRequest({ ...valid, kind: 'other' })).toThrow('invalid attention request')
  expect(() => {
    assertDesktopSender(
      { senderFrame: { url: 'dsh-app://app/' } } as unknown as IpcMainInvokeEvent,
      ['app'],
    )
  }).not.toThrow()
  expect(() => {
    assertDesktopSender(
      { senderFrame: { url: 'dsh-app://shell/' } } as unknown as IpcMainInvokeEvent,
      ['app'],
    )
  }).toThrow('unowned renderer')
})
